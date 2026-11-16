/**
 * Collects the parser's structure findings. Each file parser works on a
 * scope that fills the finding's subject (feature, flow, app, task), so a
 * rule only names the code, the message and the line.
 */
import { createFinding } from "../codes";
import type { GrimoireFinding } from "../contracts/findings";
import type { SourceLocation } from "../contracts/location";

/** The feature, flow, app and task a file is about. */
export type FindingSubject = {
  feature?: string | null;
  flow?: string | null;
  app?: string | null;
  task?: string | null;
};

/** Where the parser's findings go. */
export class FindingSink {
  public constructor(
    private readonly findings: GrimoireFinding[] = [],
    private readonly subject: FindingSubject = {},
  ) {}

  /** A sink that adds `subject` to every finding and shares this sink's list. */
  public scope(subject: FindingSubject): FindingSink {
    return new FindingSink(this.findings, { ...this.subject, ...subject });
  }

  /** Report a finding built from the catalog. */
  public report(code: string, message: string, at: SourceLocation | null): void {
    this.findings.push(
      createFinding({
        code,
        message,
        at,
        feature: this.subject.feature ?? null,
        flow: this.subject.flow ?? null,
        app: this.subject.app ?? null,
        task: this.subject.task ?? null,
      }),
    );
  }

  /** Add a finding built elsewhere (front matter errors), filling its empty subject fields. */
  public push(finding: GrimoireFinding): void {
    const subject = finding.subject;

    this.findings.push({
      ...finding,
      subject: {
        ...subject,
        feature: subject.feature ?? this.subject.feature ?? null,
        flow: subject.flow ?? this.subject.flow ?? null,
        app: subject.app ?? this.subject.app ?? null,
        task: subject.task ?? this.subject.task ?? null,
      },
    });
  }

  /** Every finding, sorted by file, then line, then code. */
  public sorted(): GrimoireFinding[] {
    return [...this.findings].sort((left, right) => {
      const leftFile = left.at?.file ?? "￿";
      const rightFile = right.at?.file ?? "￿";

      if (leftFile !== rightFile) return leftFile < rightFile ? -1 : 1;

      const lineDifference = (left.at?.line ?? 0) - (right.at?.line ?? 0);

      if (lineDifference !== 0) return lineDifference;

      return left.code < right.code ? -1 : left.code > right.code ? 1 : 0;
    });
  }
}
