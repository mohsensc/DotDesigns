import { Routes, Route } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import World from "./pages/World.tsx";
import Cover from "./pages/Cover.tsx";
import Shop from "./pages/Shop.tsx";
import PieceDetail from "./pages/PieceDetail.tsx";
import SpecialRequest from "./pages/SpecialRequest.tsx";
import CheckoutResult from "./pages/CheckoutResult.tsx";
import NotFound from "./pages/NotFound.tsx";

export default function App() {
  return (
    <>
      <Routes>
        {/* Home is now the scroll-scrubbed camera flight through the DOT gallery. */}
        <Route path="/" element={<World />} />
        {/* The former editorial cover is kept reachable here. */}
        <Route path="/cover" element={<Cover />} />
        {/* /shop/request must come before /shop/:slug or it'd be read as a slug. */}
        <Route path="/shop/request" element={<SpecialRequest />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/:slug" element={<PieceDetail />} />
        {/* Where Stripe hands the buyer back. Both are plain pages — the webhook
            is what actually records the sale, not a visit to this URL. */}
        <Route path="/checkout/success" element={<CheckoutResult outcome="success" />} />
        <Route path="/checkout/cancelled" element={<CheckoutResult outcome="cancelled" />} />
        {/* Works / About / Contact aren't built yet —
            every other path falls through to the 404. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Analytics />
    </>
  );
}
