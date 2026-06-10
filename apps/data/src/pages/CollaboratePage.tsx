import { ExternalLink, Users, GraduationCap, Building2, BarChart3, Mail } from "lucide-react";

const CollaboratePage = () => (
  <div>
    <section className="page-section page-section-wide">
      <div className="max-w-3xl mb-12">
        <div className="glass-chip inline-flex items-center gap-2 px-4 py-2 text-[11px] font-sans uppercase tracking-[0.25em] text-muted-foreground mb-8">
          Research & Collaboration
        </div>
        <h1 className="editorial-heading text-4xl md:text-5xl text-foreground mb-6">
          Partnerships for open marine science
        </h1>
        <p className="font-sans text-muted-foreground leading-relaxed">
          The BITE Data Portal welcomes collaboration with universities, research institutions, environmental organizations, and independent scientists. If our data, routes, or methodology align with your work, we are open to discussing how we might support each other.
        </p>
      </div>

      {/* Who we work with */}
      <div className="grid md:grid-cols-2 gap-4 mb-12">
        {[
          {
            icon: <GraduationCap size={22} />,
            title: "Universities & Academic Groups",
            desc: "Student projects, thesis data, course materials. Our datasets can supplement classroom teaching and hands-on research training with real-world field data.",
          },
          {
            icon: <Building2 size={22} />,
            title: "Marine Research Institutes",
            desc: "Supplementary field observations for existing monitoring programs. Route-specific data from areas not covered by institutional stations or regular research cruises.",
          },
          {
            icon: <Users size={22} />,
            title: "Environmental Organizations",
            desc: "Long-term environmental tracking, baseline data for advocacy, or comparative datasets for regional studies on sea temperature or atmospheric conditions.",
          },
          {
            icon: <BarChart3 size={22} />,
            title: "Data Analysts & Developers",
            desc: "Open datasets in standard formats for visualization, modeling, or integration with other data sources. API access may be available for technical partners.",
          },
        ].map((item) => (
          <div key={item.title} className="glass-panel rounded-2xl p-6 flex flex-col gap-4">
            <div className="h-11 w-11 rounded-xl bg-teal/10 flex items-center justify-center text-teal">
              {item.icon}
            </div>
            <h3 className="font-serif text-lg font-semibold text-foreground">{item.title}</h3>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      {/* What we can offer */}
      <div className="glass-panel rounded-2xl p-6 md:p-8 mb-12">
        <h2 className="editorial-heading text-2xl text-foreground mb-6">What we can offer</h2>
        <div className="grid md:grid-cols-2 gap-6">
          {[
            "Access to raw and processed datasets from Mediterranean sailing routes",
            "Custom data exports for specific regions, time periods, or parameters",
            "Route coordination — collecting specific measurements along planned voyages",
            "Sensor integration — deploying additional instruments aboard Spritz for specific studies",
            "Co-authorship or acknowledgment in publications using our data",
            "Educational workshops or presentations about citizen science at sea",
          ].map((item) => (
            <div key={item} className="flex items-start gap-3">
              <span className="h-1.5 w-1.5 rounded-full bg-teal mt-2 shrink-0" />
              <p className="text-sm font-sans text-muted-foreground">{item}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Contact CTA */}
      <div className="glass-panel-dark rounded-3xl p-8 md:p-12 text-center">
        <h2 className="editorial-heading text-3xl text-primary-foreground mb-4">Interested in collaborating?</h2>
        <p className="font-sans text-primary-foreground/70 max-w-lg mx-auto mb-8">
          We review all collaboration inquiries carefully. Please describe your institution, research focus, and how BITE data might support your work. We respond to serious inquiries within one week.
        </p>
        <a
          href="https://biteproject.it/contact"
          target="_blank"
          rel="noopener noreferrer"
          className="glass-chip-dark inline-flex items-center gap-2 px-6 py-3 text-sm font-sans font-medium text-primary-foreground hover:translate-y-[-1px] transition-all"
        >
          <Mail size={16} />
          Contact via BITE Project
          <ExternalLink size={13} />
        </a>
      </div>
    </section>
  </div>
);

export default CollaboratePage;
