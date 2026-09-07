// A stand-in Upstash REST endpoint, so the real inventory module can be driven
// end to end without a network or an account.
//
// It answers only the commands the module actually issues and throws on
// anything else. That's deliberate: an "unimplemented command" failure means
// the module sent something a real Redis wouldn't have understood either.
import { createServer } from "node:http";

const TOKEN = "test-token";

export function startFakeRedis() {
  const strings = new Map();
  const sets = new Map();
  const issued = [];

  function run(args) {
    const [cmd, ...rest] = args;
    issued.push(String(cmd).toUpperCase());
    switch (String(cmd).toUpperCase()) {
      case "SET":
        strings.set(rest[0], String(rest[1]));
        return "OK";
      case "GET":
        return strings.has(rest[0]) ? strings.get(rest[0]) : null;
      case "MGET":
        return rest.map(k => (strings.has(k) ? strings.get(k) : null));
      case "DEL":
        strings.delete(rest[0]);
        return 1;
      case "INCR": {
        const next = Number(strings.get(rest[0]) ?? "0") + 1;
        strings.set(rest[0], String(next));
        return next;
      }
      case "EXPIRE":
        // TTLs aren't modelled; the call is accepted so the caller's shape is real.
        return strings.has(rest[0]) ? 1 : 0;
      case "SADD": {
        const s = sets.get(rest[0]) ?? new Set();
        s.add(rest[1]);
        sets.set(rest[0], s);
        return 1;
      }
      case "SREM":
        sets.get(rest[0])?.delete(rest[1]);
        return 1;
      case "SISMEMBER":
        return sets.get(rest[0])?.has(rest[1]) ? 1 : 0;
      case "SMEMBERS":
        return [...(sets.get(rest[0]) ?? [])];
      case "EVAL": {
        // A literal translation of DECREMENT_LUA in api/_lib/inventory.ts.
        // Kept line-for-line so a divergence is obvious on sight. The real
        // atomicity is Redis's to provide; what's checked here is the maths
        // and the sold-out signal.
        const numkeys = Number(rest[1]);
        const key = rest[2];
        const by = Number(rest[2 + numkeys]);
        const current = Number(strings.get(key) ?? "0");
        if (current <= 0) return -1;
        let remaining = current - by;
        if (remaining < 0) remaining = 0;
        strings.set(key, String(remaining));
        return remaining;
      }
      default:
        throw new Error(`unimplemented command: ${cmd}`);
    }
  }

  return new Promise(resolve => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", c => (body += c));
      req.on("end", () => {
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401).end(JSON.stringify({ error: "bad token" }));
          return;
        }
        let payload;
        try {
          payload = { result: run(JSON.parse(body)) };
        } catch (err) {
          payload = { error: String(err.message) };
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
      });
    });
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, token: TOKEN, url: `http://127.0.0.1:${server.address().port}`, issued }),
    );
  });
}
