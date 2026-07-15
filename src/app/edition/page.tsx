import { redirect } from "next/navigation";
import { getEditionsList } from "@/src/lib/editions-server";

export default async function EditionRedirect() {
  const editions = await getEditionsList();
  const dates = editions.map((edition) => edition.date).sort();

  if (dates.length > 0) {
    redirect(`/edition/${dates[dates.length - 1]}`);
  }
  redirect("/");
}
