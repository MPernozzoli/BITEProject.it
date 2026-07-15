import { Download, FileText, FileJson, FileSpreadsheet, Info } from "lucide-react";

const datasets = [
  {
    name: "Western Mediterranean SST — Autumn 2025",
    version: "v1.0",
    updated: "2025-11-15",
    formats: ["CSV", "JSON"],
    size: "2.4 MB",
    records: "3,420",
  },
  {
    name: "Tyrrhenian Coastal Atmospheric Survey",
    version: "v1.1",
    updated: "2025-10-02",
    formats: ["CSV", "JSON"],
    size: "3.1 MB",
    records: "2,860",
  },
  {
    name: "Sicily Channel Passage — Spring 2025",
    version: "v1.0",
    updated: "2025-06-20",
    formats: ["CSV"],
    size: "1.8 MB",
    records: "2,100",
  },
  {
    name: "Balearic Sea Multi-Parameter",
    version: "v1.0",
    updated: "2025-11-28",
    formats: ["CSV", "JSON"],
    size: "1.5 MB",
    records: "1,540",
  },
  {
    name: "Ligurian Sea Spring Monitoring",
    version: "v1.0",
    updated: "2025-05-10",
    formats: ["CSV"],
    size: "1.9 MB",
    records: "1,890",
  },
];

const formatIcons: Record<string, typeof FileText> = {
  CSV: FileSpreadsheet,
  JSON: FileJson,
};

const DownloadsPage = () => (
  <div>
    <section className="page-section page-section-wide">
      <div className="mb-10">
        <h1 className="editorial-heading text-4xl text-foreground mb-3">Open Access & Downloads</h1>
        <p className="font-sans text-muted-foreground max-w-2xl">
          All datasets collected during BITE voyages are freely available for download. No registration required. Data is provided in standard formats with accompanying metadata.
        </p>
      </div>

      {/* Usage & Citation */}
      <div className="glass-panel rounded-2xl p-6 md:p-8 mb-8">
        <div className="flex items-start gap-4">
          <div className="h-10 w-10 rounded-xl bg-teal/10 flex items-center justify-center text-teal shrink-0">
            <Info size={20} />
          </div>
          <div>
            <h2 className="font-sans text-base font-semibold text-foreground mb-2">Usage & Citation</h2>
            <div className="space-y-3 text-sm font-sans text-muted-foreground leading-relaxed">
              <p>
                Data is released under a <strong className="text-foreground">Creative Commons Attribution 4.0</strong> license. You are free to use, share, and adapt the data for any purpose, including commercial use, provided you give appropriate credit.
              </p>
              <div className="glass-panel-soft rounded-xl p-4">
                <p className="text-xs font-mono text-muted-foreground">
                  BITE Data Portal (2025). Environmental observations from sailing vessel Spritz.<br />
                  Available at: data.biteproject.it. Accessed: [date].
                </p>
              </div>
              <p className="text-xs text-muted-foreground/70">
                Each dataset includes a metadata file with specific versioning, collection dates, sensor details, and known limitations. Please review metadata before use.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Dataset list */}
      <div className="space-y-3">
        {datasets.map((ds) => (
          <div key={ds.name} className="glass-panel rounded-2xl p-5 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1 min-w-0">
              <h3 className="font-sans text-sm font-semibold text-foreground truncate">{ds.name}</h3>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs font-sans text-muted-foreground">
                <span>{ds.version}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>Updated {ds.updated}</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{ds.records} records</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <span>{ds.size}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {ds.formats.map((fmt) => {
                const Icon = formatIcons[fmt] || FileText;
                return (
                  <button
                    key={fmt}
                    className="glass-chip inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-sans font-medium text-teal hover:text-teal-muted transition-colors"
                  >
                    <Icon size={14} />
                    {fmt}
                  </button>
                );
              })}
              <button className="glass-chip inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-sans font-medium text-foreground hover:text-teal transition-colors">
                <Download size={14} />
                Download
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Update notes */}
      <div className="mt-10 glass-panel-soft rounded-2xl p-6">
        <h3 className="font-sans text-sm font-semibold text-foreground mb-3">Versioning & Updates</h3>
        <div className="space-y-2 text-sm font-sans text-muted-foreground">
          <p>Datasets are versioned using semantic versioning (v1.0, v1.1, etc.). Minor versions indicate corrections or metadata updates. Major versions indicate structural changes or significant reprocessing.</p>
          <p>New datasets are published after each completed mission, typically within 2–4 weeks of data collection. Updates are documented in the metadata file accompanying each release.</p>
        </div>
      </div>
    </section>
  </div>
);

export default DownloadsPage;
