import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { queryEditionByDate } from "@/src/lib/db";
import { getEditionsList } from "@/src/lib/editions-server";
import { GOLD_DATE, loadGoldEdition, type GoldEditionData } from "@/src/lib/gold-edition";
import { normalizeArticles } from "@/features/news-feed/lib/normalize-articles";
import { EditionDateClient } from "./EditionDateClient";

export const dynamicParams = true;
export const revalidate = false;

type EditionData = GoldEditionData;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface EditionPageProps {
  params: Promise<{ date: string }>;
}

export async function generateMetadata({ params }: EditionPageProps): Promise<Metadata> {
  const { date } = await params;
  if (!DATE_RE.test(date)) return {};
  // Pin formatting to UTC so build-host TZ never shifts the calendar day.
  const formatted = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T12:00:00Z"));
  return {
    title: `${formatted} — The Transcript Archive`,
    description: `OWU's student newspaper for ${formatted}.`,
  };
}

async function loadEdition(date: string): Promise<EditionData | null> {
  const result = await queryEditionByDate(date);
  if (result) {
    return {
      articles: normalizeArticles(result.articles, date),
      ads: result.ads,
      publicationInfo: result.edition.publicationInfo,
    };
  }
  if (date === GOLD_DATE) {
    return loadGoldEdition();
  }
  return null;
}

export async function generateStaticParams() {
  const editions = await getEditionsList();
  return editions.map((e) => ({ date: e.date }));
}

export default async function EditionDatePage({ params }: EditionPageProps) {
  const { date } = await params;

  if (!DATE_RE.test(date)) {
    notFound();
  }

  const data = await loadEdition(date);
  if (!data) {
    notFound();
  }

  return (
    <EditionDateClient
      currentDate={date}
      articles={data.articles}
      ads={data.ads}
      publicationInfo={data.publicationInfo}
    />
  );
}
