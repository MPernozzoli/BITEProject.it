import { useState } from "react";
import { Download, FileJson, FileSpreadsheet, Info, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useVoyages } from "@/hooks/use-voyages";
import { fetchObservationExport, useObservationCounts } from "@/hooks/use-observations";
import { buildVoyageUrl } from "@/lib/voyage-link";
import { downloadBlob, toCsv } from "@/lib/csv";

const slugForFile = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "dataset";

const DownloadsPage = () => {
  const { data: voyages = [] } = useVoyages();
  const [busy, setBusy] = useState<string | null>(null);

  // Only sailed voyages carry data; a planned route would be an empty download.
  const sailed = voyages
    .filter((v) => v.type === "water" && (v.status === "completed" || v.status === "active"))
    .sort((a, b) => a.sort_order - b.sort_order);
  const { data: counts } = useObservationCounts(sailed.map((v) => v.id));

  const total = sailed.reduce((sum, v) => sum + (counts?.get(v.id) ?? 0), 0);

  const run = async (key: string, format: "csv" | "json", voyageId?: string, label?: string) => {
    setBusy(key);
    try {
      const rows = await fetchObservationExport(voyageId);
      if (rows.length === 0) {
        toast.error("Nothing to download", { description: "No published observations match this selection." });
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const name = `bite-observations-${slugForFile(label ?? "all")}-${stamp}`;
      if (format === "csv") {
        downloadBlob(toCsv(rows), `${name}.csv`, "text/csv;charset=utf-8");
      } else {
        downloadBlob(JSON.stringify(rows, null, 2), `${name}.json`, "application/json");
      }
      toast.success(`${rows.length.toLocaleString()} observations exported`);
    } catch (error) {
      // A silent failure on a download button reads as "there is no data".
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setBusy(null);
    }
  };

  const FormatButtons = ({
    keyBase,
    voyageId,
    label,
  }: {
    keyBase: string;
    voyageId?: string;
    label: string;
  }) => (
    <div className="flex items-center gap-2">
      {(["csv", "json"] as const).map((format) => {
        const key = `${keyBase}:${format}`;
        const Icon = format === "csv" ? FileSpreadsheet : FileJson;
        return (
          <button
            key={key}
            onClick={() => run(key, format, voyageId, label)}
            disabled={busy !== null}
            className="glass-chip inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-sans font-medium text-teal transition-colors hover:text-teal-muted disabled:opacity-50"
          >
            {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
            {format.toUpperCase()}
          </button>
        );
      })}
    </div>
  );

  return (
    <div>
      <section className="page-section page-section-wide">
        <div className="mb-10 max-w-2xl">
          <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-8">
            Open Access & Downloads
          </div>
          <h1 className="editorial-heading text-4xl md:text-5xl text-foreground mb-4">
            Take the data
          </h1>
          <p className="font-sans text-muted-foreground leading-relaxed">
            Every published observation, one row per sampling point and one column per variable, with
            each reading followed by its quality flag and timestamps in ISO 8601 UTC. No registration,
            no paywall. The file opens straight into Excel, R, or pandas.
          </p>
        </div>

        {/* Everything */}
        <div className="glass-panel rounded-2xl p-6 md:p-8 mb-8 flex flex-col md:flex-row md:items-center gap-5">
          <div className="flex-1">
            <h2 className="font-sans text-base font-semibold text-foreground">
              Complete dataset
            </h2>
            <p className="text-sm font-sans text-muted-foreground mt-1">
              {total > 0
                ? `${total.toLocaleString()} observations across ${sailed.length} ${sailed.length === 1 ? "voyage" : "voyages"}.`
                : "Loading…"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => run("all:csv", "csv", undefined, "all")}
              disabled={busy !== null}
              className="glass-chip inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-sans font-medium text-foreground transition-colors hover:text-teal disabled:opacity-50"
            >
              {busy === "all:csv" ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Download CSV
            </button>
            <button
              onClick={() => run("all:json", "json", undefined, "all")}
              disabled={busy !== null}
              className="glass-chip inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-sans font-medium text-teal transition-colors hover:text-teal-muted disabled:opacity-50"
            >
              {busy === "all:json" ? <Loader2 size={14} className="animate-spin" /> : <FileJson size={14} />}
              JSON
            </button>
          </div>
        </div>

        {/* Per voyage */}
        <h2 className="editorial-heading text-xl text-foreground mb-3">By voyage</h2>
        <div className="space-y-3">
          {sailed.map((voyage) => {
            const count = counts?.get(voyage.id);
            const name = voyage.name_en || voyage.name;
            return (
              <div
                key={voyage.id}
                className="glass-panel rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <a
                    href={buildVoyageUrl(voyage)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex items-center gap-1.5 font-sans text-sm font-semibold text-foreground transition-colors hover:text-teal"
                  >
                    <span className="truncate">{name}</span>
                    <ExternalLink size={11} className="shrink-0 text-muted-foreground/60 transition-colors group-hover:text-teal" />
                  </a>
                  <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs font-sans text-muted-foreground">
                    <span className="capitalize">{voyage.status}</span>
                    {voyage.start_date && (
                      <>
                        <span className="h-1 w-1 rounded-full bg-border" />
                        <span>
                          {voyage.start_date}
                          {voyage.end_date ? ` → ${voyage.end_date}` : ""}
                        </span>
                      </>
                    )}
                    <span className="h-1 w-1 rounded-full bg-border" />
                    <span>{count === undefined ? "…" : `${count.toLocaleString()} observations`}</span>
                  </div>
                </div>
                <FormatButtons keyBase={voyage.id} voyageId={voyage.id} label={name} />
              </div>
            );
          })}
        </div>

        {/* Licence & citation */}
        <div className="glass-panel rounded-2xl p-6 md:p-8 mt-10">
          <div className="flex items-start gap-4">
            <div className="h-10 w-10 rounded-xl bg-teal/10 flex items-center justify-center text-teal shrink-0">
              <Info size={20} />
            </div>
            <div>
              <h2 className="font-sans text-base font-semibold text-foreground mb-2">
                Why this is free, and how to cite it
              </h2>
              <div className="space-y-3 text-sm font-sans text-muted-foreground leading-relaxed">
                <p>
                  Environmental data collected in the field — especially in under-monitored areas — has
                  value beyond any single project. By releasing it under open-access terms, we let
                  researchers, institutions, educators, and curious minds use this material for their own
                  purposes. There is no paywall, no registration requirement, and no commercial intent.
                  If the data is useful, it should be available.
                </p>
                <p>
                  Data is released under a{" "}
                  <strong className="text-foreground">Creative Commons Attribution 4.0</strong> license.
                  You are free to use, share, and adapt it for any purpose, including commercial use,
                  provided you give appropriate credit.
                </p>
                <div className="glass-panel-soft rounded-xl p-4">
                  <p className="text-xs font-mono text-muted-foreground">
                    BITE Data Portal ({new Date().getFullYear()}). Environmental observations from sailing
                    vessel Spritz.
                    <br />
                    Available at: data.biteproject.it. Accessed: [date].
                  </p>
                </div>
                <p className="text-xs text-muted-foreground/70">
                  Read the{" "}
                  <a href="/methodology" className="text-teal hover:text-teal-muted transition-colors">
                    methodology and known limitations
                  </a>{" "}
                  before use: this is field data from a moving sailing vessel, not reference-grade
                  instrumentation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default DownloadsPage;
