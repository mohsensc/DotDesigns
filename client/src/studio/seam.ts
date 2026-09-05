// The studio talks to the server through here and nowhere else.
//
// One import site for the whole tool: when the store changes shape, this file
// is the only thing that has to know about it.
export {
  loadStudioCatalog,
  savePiece,
  deletePiece,
  reorderPieces,
  uploadMedia,
  deleteMedia,
  resolveMedia,
  loadInventoryRow,
  StudioAuthError,
  CatalogConflictError,
} from "../lib/catalog-store.ts";
