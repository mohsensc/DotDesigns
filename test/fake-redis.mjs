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
  const sorted = new Map();
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
      case "ZREM":
        sorted.get(rest[0])?.delete(rest[1]);
        return 1;
      case "EVAL": {
        const script = String(rest[0]);
        const numkeys = Number(rest[1]);
        const keys = rest.slice(2, 2 + numkeys);
        const argv = rest.slice(2 + numkeys);
        if (script.includes("ZREMRANGEBYSCORE")) {
          const members = sorted.get(keys[1]) ?? new Map();
          sorted.set(keys[1], members);
          for (const [member, score] of members) if (score <= Number(argv[1])) members.delete(member);
          if (members.has(argv[0])) {
            members.set(argv[0], Number(argv[2]));
            return 1;
          }
          const stock = Number(strings.get(keys[0]) ?? "0");
          if (stock < 1) return -1;
          if (stock - members.size < 1) return 0;
          members.set(argv[0], Number(argv[2]));
          return 1;
        }
        if (script.includes("604800")) {
          if (argv[1] !== "") {
            if (strings.has(keys[2])) return -2;
            strings.set(keys[2], "1");
          }
          if (argv[0] !== "") sorted.get(keys[1])?.delete(argv[0]);
          const current = Number(strings.get(keys[0]) ?? "0");
          if (current <= 0) return -1;
          strings.set(keys[0], String(current - 1));
          return current - 1;
        }
        if (script.includes("source")) {
          const source = strings.get(keys[1]);
          if (argv[0] !== "" && Number(source ?? "0") !== Number(argv[0])) return -1;
          if (argv[1] !== "") strings.set(keys[0], argv[1]);
          else if (keys[0] !== keys[1] && source !== undefined) strings.set(keys[0], source);
          return 1;
        }
        if (script.includes("seen")) {
          const seen = strings.has(keys[1]) ? strings.get(keys[1]) : argv[2];
          if (seen !== argv[1]) return seen;
          strings.set(keys[0], argv[0]);
          strings.set(keys[1], argv[3]);
          return "ok";
        }
        const by = Number(argv[0]);
        const current = Number(strings.get(keys[0]) ?? "0");
        if (current <= 0) return -1;
        let remaining = current - by;
        if (remaining < 0) remaining = 0;
        strings.set(keys[0], String(remaining));
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
