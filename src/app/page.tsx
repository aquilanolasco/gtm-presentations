import { redirect } from "next/navigation";

// This repo carries only the Presentations module, so the workspace home goes straight there.
export default function Home() {
  redirect("/presentations");
}
