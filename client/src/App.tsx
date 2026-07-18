import { Routes, Route } from "react-router-dom";
import World from "./pages/World.tsx";
import Cover from "./pages/Cover.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <Routes>
      {/* Home is now the scroll-scrubbed camera flight through the DOT gallery. */}
      <Route path="/" element={<World />} />
      {/* The former editorial cover is kept reachable here. */}
      <Route path="/cover" element={<Cover />} />
      {/* Works / About / Contact / the Collection aren't built yet —
          every other path falls through to the 404. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
