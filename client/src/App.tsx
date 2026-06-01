import { Routes, Route } from "react-router-dom";
import Cover from "./pages/Cover.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Cover />} />
      {/* Works / About / Contact / the Collection aren't built yet —
          every other path falls through to the 404. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
