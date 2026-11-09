import { router } from "../index";
import { adminRouter } from "./admin";
import { presentationsRouter } from "./presentations";

// Presentations-only export. The full app mounts every module's router here; this repo wires up
// only the presentations router, plus the trimmed admin stub whose myProfile query the
// Presentations page reads for its role check.
export const appRouter = router({
  admin: adminRouter,
  presentations: presentationsRouter,
});

export type AppRouter = typeof appRouter;
