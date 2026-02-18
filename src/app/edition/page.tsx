import { redirect } from "next/navigation";
import fs from "fs";
import path from "path";

export default function EditionRedirect() {
  const editionsDir = path.join(process.cwd(), "public/editions");
  let dates: string[] = [];
  try {
    dates = fs
      .readdirSync(editionsDir)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
      .sort();
  } catch {
    // no editions directory
  }

  if (dates.length > 0) {
    redirect(`/edition/${dates[dates.length - 1]}`);
  }
  redirect("/");
}
