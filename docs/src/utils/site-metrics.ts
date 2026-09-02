import { getCollection } from "astro:content";
import changelog from "../data/changelog.json";

type ChangelogData = { packages?: unknown[] };

export type SiteMetrics = {
  publishedPackageCount: number;
  documentationPageCount: number;
  documentedTopicCount: number;
};

let metricsPromise: Promise<SiteMetrics> | undefined;

async function loadSiteMetrics(): Promise<SiteMetrics> {
  const packages = (changelog as ChangelogData).packages;
  if (!Array.isArray(packages)) {
    throw new TypeError("Generated changelog data is missing its packages array.");
  }

  const docs = (await getCollection("docs")).filter(({ data }) => data.draft !== true);
  const documentedTopics = new Set<string>();

  for (const { id } of docs) {
    const topic = /^v\/latest\/([^/]+)(?:\/|$)/.exec(id)?.[1];
    if (topic) documentedTopics.add(topic);
  }

  return {
    publishedPackageCount: packages.length,
    documentationPageCount: docs.length,
    documentedTopicCount: documentedTopics.size,
  };
}

/** Build-time site metrics derived from committed canonical data and content. */
export function getSiteMetrics(): Promise<SiteMetrics> {
  return metricsPromise ??= loadSiteMetrics();
}
