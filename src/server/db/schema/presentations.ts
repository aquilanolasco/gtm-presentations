import { pgTable, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

// User-created presentations (the "Your Presentations" tab). The three master decks live in
// code (they are hand-built static decks); this table holds decks a person generates via
// Create, their generation status, their exports, and their sharing settings. A deck can be
// shared to the whole company (companyShared), to a pick-list of people (sharedEmails), and/or
// via a public link (publicEnabled -> /p/<slug>). Exports are built by the export pipeline.
export const presentations = pgTable("presentations", {
  id:            text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title:         text("title").notNull(),
  ownerEmail:    text("owner_email").notNull(),
  slug:          text("slug").notNull(),                 // deck folder + public id
  status:        text("status").notNull().default("ready"), // generating | ready | failed
  statusMsg:     text("status_msg"),                     // progress / error detail
  sourceFile:    text("source_file"),                    // original upload name
  coverStyle:    text("cover_style").notNull().default("master"), // master | gradient | light | dark
  buildMode:     text("build_mode").notNull().default("full"),    // full (reconstruct) | quick (fast frame, simple templates)
  // Where the created deck lands: "general" -> My Decks, "sales" -> the Sales Decks tab. Chosen on Create.
  kind:          text("kind").notNull().default("general"),        // general | sales
  // which build engine produced this deck. "claude" = in-app HTML deck (served at /p/<slug>/, the
  // legacy default so existing rows keep working); "gamma" = built via the Gamma API (hosted on
  // gamma.app, Present opens gammaUrl, PPTX/PDF downloaded into our exports).
  engine:        text("engine").notNull().default("claude"),      // claude | gamma
  gammaUrl:      text("gamma_url"),                      // gamma.app deck url (Present / Edit on Gamma)
  sourceAudio:   text("source_audio"),                   // spooled voice-memo filename, if recorded
  slideCount:    text("slide_count"),
  deckUrl:       text("deck_url"),                       // authed viewer url
  publicEnabled: boolean("public_enabled").notNull().default(false),
  companyShared: boolean("company_shared").notNull().default(false),
  companyRole:   text("company_role").notNull().default("view"), // view | edit (when companyShared)
  sharedEmails:  jsonb("shared_emails").notNull().default([]),    // { email: string, role: "view" | "edit" }[]
  pptxReady:     boolean("pptx_ready").notNull().default(false),
  pdfReady:      boolean("pdf_ready").notNull().default(false),
  canvaUrl:      text("canva_url"),
  // soft-delete: archived decks are hidden from every list but fully recoverable (super admin can
  // restore or permanently delete them from the Archived view). Nothing is ever hard-deleted by default.
  archived:      boolean("archived").notNull().default(false),
  // live generation progress the relay streams in: { stage, slidesTotal, slidesDone, log: string[] }
  progress:      jsonb("progress").notNull().default({}),
  // Engagement (prospect sales) decks, engine = "engage": what the rep asked for. { url, client, logo, hero,
  // notes, presenter: {name,title,email,phone,avatar,booking}, body: string[], scout: {...} }. The VPS
  // engage worker reads it, writes the deck's spec.json, and the row then behaves like any user deck.
  brief:         jsonb("brief").notNull().default({}),
  // Slide Editor patch layer: { "<slideIdx.leafIdx>": { text?, color?, fontSize?, fontWeight?, ... } }.
  // Applied on top of the rendered deck by /pp-edit.js so on-canvas edits persist without re-generating.
  edits:         jsonb("edits").notNull().default({}),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
  updatedAt:     timestamp("updated_at").defaultNow().notNull(),
});
