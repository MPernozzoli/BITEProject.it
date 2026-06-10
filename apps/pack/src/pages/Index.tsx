import { Nav } from "@/components/Nav";
import { Hero } from "@/components/sections/Hero";
import { Overview } from "@/components/sections/Overview";
import { ChoosePath } from "@/components/sections/ChoosePath";
import { BrandKit, CastingProfile } from "@/components/sections/BrandAndCasting";
import { Profiles } from "@/components/sections/Profiles";
import { DuoProfile } from "@/components/sections/DuoProfile";
import { Metrics } from "@/components/sections/Metrics";
import { Work } from "@/components/sections/Work";
import { Gallery } from "@/components/sections/Gallery";
import { Services, Why, PressKit } from "@/components/sections/Services";
import { Contact } from "@/components/sections/Contact";
import { Footer } from "@/components/sections/Footer";

const Index = () => {
  return (
    <div className="site-shell min-h-screen bg-background text-foreground antialiased">
      <div className="site-shell__ambient" aria-hidden>
        <span className="site-shell__orb site-shell__orb--one" />
        <span className="site-shell__orb site-shell__orb--two" />
        <span className="site-shell__orb site-shell__orb--three" />
      </div>
      <Nav />
      <main>
        <Hero />
        <Overview />
        <ChoosePath />
        <BrandKit />
        <CastingProfile />
        <Profiles />
        <DuoProfile />
        <Metrics />
        <Work />
        <Gallery />
        <Services />
        <Why />
        <PressKit />
        <Contact />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
