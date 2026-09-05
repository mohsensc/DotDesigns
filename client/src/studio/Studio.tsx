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

  useEffect(() => {
    if (!unlocked) return;
    let cancelled = false;
    setLoadError(null);
    loadStudioCatalog()
      .then(next => {
        if (!cancelled) applyCatalog(next);
      })
      .catch(err => {
        if (cancelled) return;
        if (err instanceof StudioAuthError) return endSession();
        setLoadError(err instanceof Error ? err.message : "Couldn't load your pieces.");
      });
    return () => {
      cancelled = true;
    };
  }, [unlocked, applyCatalog, endSession]);

  const pieces = [...(catalog?.pieces ?? [])].sort((a, b) => a.order - b.order);
  const openPiece = route.name === "piece" ? pieces.find(p => p.id === route.id) ?? null : null;

  /** Every write goes through here: one busy line, one error line, one auth path. */
  async function run(label: string, work: () => Promise<Catalog>) {
    setBusy(label);
    setActionError(null);
    try {
      applyCatalog(await work());
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
  }

  async function toggleSold(piece: Piece) {
    const nextStatus = piece.status === "sold" ? "available" : "sold";
    const quantity = nextStatus === "sold" ? 0 : 1;
    // The stock count is what the shop actually charges against — flipping the
    // status without it would say Sold here while the shop kept selling. Carry
    // the notes over or this blank write would wipe them.
    let notes = "";
    try {
      notes = (await loadInventoryRow(piece.slug))?.notes ?? "";
    } catch (err) {
      if (err instanceof StudioAuthError) return endSession();
    }
    await run("Saving…", () =>
      savePiece({ ...piece, status: nextStatus }, quantity, notes, expectedUpdatedAt()),
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

  async function move(piece: Piece, direction: -1 | 1) {
    const idx = pieces.findIndex(p => p.id === piece.id);
    const swap = idx + direction;
    if (idx === -1 || swap < 0 || swap >= pieces.length) return;
    const order = pieces.map(p => p.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    await run("Reordering…", () => reorderPieces(order, expectedUpdatedAt()));
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
              onBack={() => setRoute({ name: "grid" })}
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
              title="Your pieces"
              extra={
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
              }
            />
            <div className="screen-body">
              {loadError && <p className="banner-error">{loadError}</p>}
              {!catalog && !loadError && <p className="empty-note">Loading your pieces…</p>}
              {catalog && <HomeGrid pieces={pieces} onOpen={id => setRoute({ name: "piece", id })} />}
            </div>
          </div>
        )}

        {(busy || actionError) && !composing && (
          <p className={`toast${actionError ? " toast-error" : ""}`} role="status">
            {actionError ?? busy}
          </p>
        )}

        {!composing && (
          <TabBar
            tab={tab}
            onTab={next => {
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
          <ActionSheet items={[{ label: "Log out", onClick: () => void logOut() }]} onClose={() => setSheet(null)} />
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
                label: "Move earlier",
                disabled: pieces[0]?.id === openPiece.id,
                onClick: () => {
                  setSheet(null);
                  void move(openPiece, -1);
                },
              },
              {
                label: "Move later",
                disabled: pieces[pieces.length - 1]?.id === openPiece.id,
                onClick: () => {
                  setSheet(null);
                  void move(openPiece, 1);
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
