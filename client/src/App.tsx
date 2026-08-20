import { Routes, Route } from "react-router-dom";
import World from "./pages/World.tsx";
import Cover from "./pages/Cover.tsx";
import Shop from "./pages/Shop.tsx";
import PieceDetail from "./pages/PieceDetail.tsx";
import SpecialRequest from "./pages/SpecialRequest.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <Routes>
      {/* Home is now the scroll-scrubbed camera flight through the DOT gallery. */}
      <Route path="/" element={<World />} />
      {/* The former editorial cover is kept reachable here. */}
      <Route path="/cover" element={<Cover />} />
      {/* /shop/request must come before /shop/:slug or it'd be read as a slug. */}
      <Route path="/shop/request" element={<SpecialRequest />} />
      <Route path="/shop" element={<Shop />} />
      <Route path="/shop/:slug" element={<PieceDetail />} />
      {/* Works / About / Contact aren't built yet —
          every other path falls through to the 404. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
