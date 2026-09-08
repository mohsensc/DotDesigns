import { useCallback, useEffect, useRef, useState } from "react";
import type { Catalog, Piece } from "../lib/catalog.ts";
import ActionSheet from "./ActionSheet.tsx";
import Composer from "./Composer.tsx";
import ConfirmDialog from "./ConfirmDialog.tsx";
import HomeGrid from "./HomeGrid.tsx";
import InventoryTable from "./InventoryTable.tsx";
import LockScreen from "./LockScreen.tsx";
import PieceScreen from "./PieceScreen.tsx";
import ScreenHeader from "./ScreenHeader.tsx";
import {
  CatalogConflictError,
  deletePiece,
  loadInventoryRow,
  loadStudioCatalog,
  reorderPieces,
  savePiece,
  StudioAuthError,
} from "./seam.ts";
import TabBar, { type Tab } from "./TabBar.tsx";
import { newId, slugify } from "./util.ts";

type Route = { name: "grid" } | { name: "piece"; id: string };
type Composing = { mode: "new" | "edit"; piece: Piece } | null;

function blankPiece(catalog: Catalog | null): Piece {
  // Lowest order sorts first, so a new post lands at the top of her grid the
  // way it would on Instagram — same key the shop sorts by.
  const lowest = catalog?.pieces.length ? Math.min(...catalog.pieces.map(p => p.order)) : 1;
  return {
    id: newId("p"),
    slug: "",
    title: "",
    category: "sculpture",
    status: "available",
    price: null,
    blurb: "",
    description: "",
    media: [],
    order: lowest - 1,
    createdAt: new Date().toISOString(),
  };
}

export default function Studio() {
  // Locked on every load, no exceptions and no auto-unlock check. Unlocking
  // lasts as long as this page does and no longer.
  const [unlocked, setUnlocked] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  // Bumped on every unlock. The Stock tab stays mounted behind the lock
  // screen, so it needs telling that signing back in happened.
  const [session, setSession] = useState(0);

  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [route, setRoute] = useState<Route>({ name: "grid" });
  const [composing, setComposing] = useState<Composing>(null);
  const [sheet, setSheet] = useState<"piece" | "home" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Piece | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Reorder mode holds the new order locally so the whole rearrange is one
  // write on Done instead of one per position.
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);

  // Writes send the updatedAt they were built on. Read it late — a retry after
  // signing back in is working off a newer catalog than the one on screen was.
  const catalogRef = useRef<Catalog | null>(null);
  const applyCatalog = useCallback((next: Catalog) => {
    catalogRef.current = next;
    setCatalog(next);
  }, []);
  const expectedUpdatedAt = useCallback(() => catalogRef.current?.updatedAt ?? "", []);

  const endSession = useCallback(() => {
    setUnlocked(false);
    setSessionEnded(true);
  }, []);

  // Back out of bfcache (she switched apps and came back) counts as a fresh
  // load, so lock it again rather than showing a page that may be stale. Not
  // a dropped session, so no "signed out" line — she just signs in again.
  useEffect(() => {
    function onShow(e: PageTransitionEvent) {
      if (e.persisted) setUnlocked(false);
    }
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Bumped to abandon an in-flight load. Callable so the error can offer a
  // retry rather than sending her back to the password.
  const loadToken = useRef(0);
  const loadPieces = useCallback(async () => {
    const token = ++loadToken.current;
    setLoadError(null);
    try {
      const next = await loadStudioCatalog();
      if (token === loadToken.current) applyCatalog(next);
    } catch (err) {
      if (token !== loadToken.current) return;
      if (err instanceof StudioAuthError) return endSession();
      setLoadError(err instanceof Error ? err.message : "Couldn't load your pieces.");
    }
  }, [applyCatalog, endSession]);

  useEffect(() => {
    if (!unlocked) return;
    void loadPieces();
    return () => {
      loadToken.current++;
    };
  }, [unlocked, loadPieces]);

  const pieces = [...(catalog?.pieces ?? [])].sort((a, b) => a.order - b.order);
  const openPiece = route.name === "piece" ? pieces.find(p => p.id === route.id) ?? null : null;
  const reordering = draftOrder !== null;
  const gridPieces = draftOrder
    ? draftOrder.flatMap(id => pieces.filter(p => p.id === id))
    : pieces;

  /** Every write goes through here: one busy line, one error line, one auth path. */
  /** Resolves true when the write landed, so a caller can keep a draft otherwise. */
  async function run(label: string, work: () => Promise<Catalog>): Promise<boolean> {
    setBusy(label);
    setActionError(null);
    try {
      applyCatalog(await work());
      return true;
    } catch (err) {
      if (err instanceof StudioAuthError) {
        endSession();
      } else if (err instanceof CatalogConflictError) {
        applyCatalog(err.catalog);
        setActionError("Something else changed first. Have a look and try again.");
      } else {
        setActionError(err instanceof Error ? err.message : "That didn't go through. Try again.");
      }
    } finally {
      setBusy(null);
    }
    return false;
  }

  async function toggleSold(piece: Piece) {
    const nextStatus = piece.status === "sold" ? "available" : "sold";
    // The stock count is what the shop actually charges against — flipping the
    // status without it would say Sold here while the shop kept selling. The
    // count and the private note both live in that row, so read it first: a
    // blind write wipes the note and flattens the count.
    let row: Awaited<ReturnType<typeof loadInventoryRow>>;
    try {
      row = await loadInventoryRow(piece.slug);
    } catch (err) {
      if (err instanceof StudioAuthError) return endSession();
      // Couldn't read it, so don't write over it.
      setActionError("Couldn't check the stock for this piece. Try again.");
      return;
    }
    // Back in stock puts the old count back. A stored 0 is what marking it sold
    // wrote, so that one becomes 1 or nothing goes back on sale.
    const quantity = nextStatus === "sold" ? 0 : row && row.quantity > 0 ? row.quantity : 1;
    await run("Saving…", () =>
      savePiece({ ...piece, status: nextStatus }, quantity, row?.notes ?? "", expectedUpdatedAt()),
    );
  }

  async function duplicate(piece: Piece) {
    const title = `${piece.title || "Untitled piece"} (copy)`;
    const copy: Piece = {
      ...blankPiece(catalogRef.current),
      title,
      // The copy needs its own URL. The server makes it unique from here.
      slug: slugify(title),
      category: piece.category,
      price: piece.price,
      blurb: piece.blurb,
      description: piece.description,
      materials: piece.materials,
      size: piece.size,
      dimensions: piece.dimensions,
      year: piece.year,
      // Photos aren't copied: two pieces pointing at one file means deleting
      // either one blanks the other.
      status: "draft",
    };
    await run("Copying…", () => savePiece(copy, 0, "", expectedUpdatedAt()));
    setRoute({ name: "grid" });
  }

  function moveInDraft(id: string, direction: -1 | 1) {
    setDraftOrder(prev => {
      if (!prev) return prev;
      const idx = prev.indexOf(id);
      const swap = idx + direction;
      if (idx === -1 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  async function finishReorder() {
    const order = draftOrder;
    if (!order) return;
    const current = pieces.map(p => p.id);
    if (order.length === current.length && order.every((id, i) => id === current[i])) {
      setDraftOrder(null);
      return;
    }
    // The draft stays up until the save lands. A failed save shouldn't cost her
    // every move she just made.
    const saved = await run("Saving the new order…", () => reorderPieces(order, expectedUpdatedAt()));
    if (saved) setDraftOrder(null);
  }

  async function logOut() {
    setSheet(null);
    try {
      await fetch("/api/studio-auth?logout=1", { method: "POST" });
    } catch {
      // Locking is the part that matters, and that's local.
    }
    setUnlocked(false);
    setSessionEnded(false);
    setCatalog(null);
    catalogRef.current = null;
    setRoute({ name: "grid" });
    setTab("home");
  }

  return (
    <>
      <div className={`studio-app${unlocked ? "" : " studio-app-hidden"}`} aria-hidden={!unlocked}>
        {composing ? (
          <Composer
            mode={composing.mode}
            piece={composing.piece}
            getExpectedUpdatedAt={expectedUpdatedAt}
            onSessionEnded={endSession}
            onCancel={() => setComposing(null)}
            onPosted={(next, pieceId) => {
              applyCatalog(next);
              setComposing(null);
              setTab("home");
              setRoute(composing.mode === "edit" ? { name: "piece", id: pieceId } : { name: "grid" });
            }}
          />
        ) : tab === "stock" ? (
          <div className="screen">
            <ScreenHeader title="Stock" />
            <div className="screen-body">
              <InventoryTable session={session} onSessionEnded={endSession} />
            </div>
          </div>
        ) : openPiece ? (
          <div className="screen">
            <ScreenHeader
              title={openPiece.title || "Untitled piece"}
              onBack={() => {
                setActionError(null);
                setRoute({ name: "grid" });
              }}
              backLabel="Back to your pieces"
              extra={
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setSheet("piece")}
                  aria-label="More actions"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                    <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                  </svg>
                </button>
              }
            />
            <div className="screen-body">
              <PieceScreen
                piece={openPiece}
                onEdit={() => setComposing({ mode: "edit", piece: openPiece })}
              />
            </div>
          </div>
        ) : (
          <div className="screen">
            <ScreenHeader
              title={reordering ? "Put them in order" : "Your pieces"}
              extra={
                reordering ? (
                  <button
                    type="button"
                    className="header-action"
                    onClick={() => void finishReorder()}
                  >
                    Done
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setSheet("home")}
                    aria-label="More actions"
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                      <circle cx="5" cy="12" r="1.8" fill="currentColor" />
                      <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                      <circle cx="19" cy="12" r="1.8" fill="currentColor" />
                    </svg>
                  </button>
                )
              }
            />
            <div className="screen-body">
              {loadError && (
                <div className="load-failed">
                  <p className="banner-error">{loadError}</p>
                  <button type="button" className="btn btn-plain" onClick={() => void loadPieces()}>
                    Try again
                  </button>
                </div>
              )}
              {!catalog && !loadError && <p className="empty-note">Loading your pieces…</p>}
              {reordering && (
                <p className="reorder-note">
                  Move a piece with the arrows. Tap Done when it looks right.
                </p>
              )}
              {catalog && (
                <HomeGrid
                  pieces={gridPieces}
                  reordering={reordering}
                  onMove={moveInDraft}
                  onOpen={id => {
                    setActionError(null);
                    setRoute({ name: "piece", id });
                  }}
                />
              )}
            </div>
          </div>
        )}

        {(busy || actionError) && !composing && (
          // Remounted when it flips kind: a live region that's already in the
          // DOM doesn't re-announce when its role changes underneath it.
          <p
            key={actionError ? "error" : "busy"}
            className={`toast${actionError ? " toast-error" : ""}`}
            role={actionError ? "alert" : "status"}
          >
            <span>{actionError ?? busy}</span>
            {actionError && (
              <button
                type="button"
                className="toast-dismiss"
                onClick={() => setActionError(null)}
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
          </p>
        )}

        {!composing && !reordering && (
          <TabBar
            tab={tab}
            onTab={next => {
              setActionError(null);
              setTab(next);
              if (next === "home") setRoute({ name: "grid" });
            }}
            onNewPost={() => {
              setTab("home");
              setComposing({ mode: "new", piece: blankPiece(catalogRef.current) });
            }}
          />
        )}

        {sheet === "home" && (
          <ActionSheet
            onClose={() => setSheet(null)}
            items={[
              {
                label: "Put your pieces in order",
                disabled: pieces.length < 2,
                onClick: () => {
                  setSheet(null);
                  setActionError(null);
                  setDraftOrder(pieces.map(p => p.id));
                },
              },
              { label: "Log out", onClick: () => void logOut() },
            ]}
          />
        )}

        {sheet === "piece" && openPiece && (
          <ActionSheet
            onClose={() => setSheet(null)}
            items={[
              {
                label: openPiece.status === "sold" ? "Mark as back in stock" : "Mark as sold",
                onClick: () => {
                  setSheet(null);
                  void toggleSold(openPiece);
                },
              },
              {
                label: "Make a copy",
                onClick: () => {
                  setSheet(null);
                  void duplicate(openPiece);
                },
              },
              {
                label: "Delete this piece",
                danger: true,
                onClick: () => {
                  setSheet(null);
                  setPendingDelete(openPiece);
                },
              },
            ]}
          />
        )}

        {pendingDelete && (
          <ConfirmDialog
            title={`Delete "${pendingDelete.title || "this piece"}"?`}
            body="This takes it off the website along with its photos and videos. It can't be undone."
            confirmLabel="Delete piece"
            onCancel={() => setPendingDelete(null)}
            onConfirm={() => {
              const target = pendingDelete;
              setPendingDelete(null);
              setRoute({ name: "grid" });
              void run("Deleting…", () => deletePiece(target.id, expectedUpdatedAt()));
            }}
          />
        )}
      </div>

      {!unlocked && (
        <LockScreen
          sessionEnded={sessionEnded}
          onUnlocked={() => {
            setSessionEnded(false);
            setSession(n => n + 1);
            setUnlocked(true);
          }}
        />
      )}
    </>
  );
}
