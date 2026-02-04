-- CreateTable
CREATE TABLE "Edition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "editionDate" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "summary" TEXT,
    "fullText" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "byline" TEXT,
    "page" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "imageCaption" TEXT,
    "isHero" BOOLEAN NOT NULL DEFAULT false,
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Article_editionDate_fkey" FOREIGN KEY ("editionDate") REFERENCES "Edition" ("date") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Edition_date_key" ON "Edition"("date");

-- CreateIndex
CREATE INDEX "Article_editionDate_idx" ON "Article"("editionDate");

-- CreateIndex
CREATE INDEX "Article_category_idx" ON "Article"("category");
