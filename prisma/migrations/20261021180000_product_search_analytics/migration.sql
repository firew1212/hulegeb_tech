CREATE TABLE "SearchTermAnalytics" (
    "term" VARCHAR(100) NOT NULL,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "totalResultCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SearchTermAnalytics_pkey" PRIMARY KEY ("term")
);

CREATE INDEX "SearchTermAnalytics_searchCount_idx"
ON "SearchTermAnalytics"("searchCount");
