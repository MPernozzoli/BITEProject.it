import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRight, Instagram, Mail, MapPin, MessageCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionHeader } from "@/components/SectionHeader";
import { toast } from "@/hooks/use-toast";
import { instagramProfile, isItalian, uiCopy } from "@/data/site";

const inquirySchema = z.object({
  name: z.string().trim().min(2, isItalian ? "Aggiungi un nome utilizzabile sul call sheet" : "Add a name we can use on the call sheet").max(100),
  company: z.string().trim().max(120).optional().or(z.literal("")),
  email: z.string().trim().email(isItalian ? "Inserisci un'email valida" : "Use a working email").max(255),
  inquiry: z.string().min(1, isItalian ? "Scegli una categoria" : "Pick a lane"),
  details: z.string().trim().min(10, isItalian ? "Qualche dettaglio concreto aiuta" : "A few concrete lines help").max(1500),
  timeline: z.string().trim().max(120).optional().or(z.literal("")),
  budget: z.string().trim().max(120).optional().or(z.literal("")),
});

type InquiryValues = z.infer<typeof inquirySchema>;

const inquiryTypes = isItalian
  ? ["Collaborazione brand", "Contenuto sponsorizzato", "Casting / produzione", "Editoriale / stills", "Ambassador arc", "Altro"]
  : ["Brand collaboration", "Sponsored content", "Casting / production", "Editorial / stills", "Ambassador arc", "Other"];

const inputInner =
  "h-11 border-0 bg-transparent px-4 text-sm text-cream placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0";

export const Contact = () => {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<InquiryValues>({
    resolver: zodResolver(inquirySchema),
    defaultValues: {
      name: "",
      company: "",
      email: "",
      inquiry: "",
      details: "",
      timeline: "",
      budget: "",
    },
  });

  const inquiryValue = watch("inquiry");

  const onSubmit = async (values: InquiryValues) => {
    await new Promise((r) => setTimeout(r, 600));
    toast({
      title: isItalian ? "Richiesta registrata" : "Inquiry logged",
      description: isItalian
        ? `Grazie, ${values.name}. Rispondiamo entro due giorni lavorativi.`
        : `Thanks, ${values.name}. Expect a reply within two working days.`,
    });
    reset();
  };

  return (
    <section id="contact" className="page-section pt-6 md:pt-8 pb-16 md:pb-24">
      <div className="container-editorial">
        <div className="glass-panel rounded-[38px] p-8 md:p-12 lg:p-14">
          <div className="grid gap-10 lg:grid-cols-12 lg:gap-16">
            <div className="lg:col-span-5">
              <SectionHeader
                eyebrow={uiCopy.contact.eyebrow}
                title={uiCopy.contact.title}
                description={uiCopy.contact.body}
              />

              <div className="mt-12 space-y-2">
                <ContactRow
                  icon={<Mail size={16} />}
                  label="Email"
                  value="hello@biteproject.it"
                  href="mailto:hello@biteproject.it"
                />
                <ContactRow
                  icon={<Instagram size={16} />}
                  label="Instagram"
                  value={`@${instagramProfile.handle}`}
                  href={instagramProfile.url}
                />
                <ContactRow
                  icon={<MessageCircle size={16} />}
                  label="WhatsApp"
                  value={uiCopy.contact.whatsapp}
                  href="https://wa.me/00000000000"
                />
                <ContactRow
                  icon={<MapPin size={16} />}
                  label={isItalian ? "Base" : "Based"}
                  value={uiCopy.contact.based}
                />
              </div>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 lg:col-span-7">
              <div className="grid gap-6 sm:grid-cols-2">
                <Field label={isItalian ? "Nome" : "Name"} error={errors.name?.message}>
                  <div className="glass-input">
                    <Input {...register("name")} placeholder={isItalian ? "Nome sul call sheet" : "Name on the call sheet"} className={inputInner} />
                  </div>
                </Field>
                <Field label={isItalian ? "Azienda / agenzia" : "Company / agency"} error={errors.company?.message}>
                  <div className="glass-input">
                    <Input {...register("company")} placeholder="Optional" className={inputInner} />
                  </div>
                </Field>
              </div>

              <Field label="Email" error={errors.email?.message}>
                <div className="glass-input">
                  <Input
                    {...register("email")}
                    type="email"
                    placeholder="you@company.com"
                    className={inputInner}
                  />
                </div>
              </Field>

              <Field label={isItalian ? "Tipo richiesta" : "Inquiry type"} error={errors.inquiry?.message}>
                <div className="glass-input">
                  <Select
                    value={inquiryValue}
                    onValueChange={(v) => setValue("inquiry", v, { shouldValidate: true })}
                  >
                    <SelectTrigger className={`${inputInner} h-11`}>
                      <SelectValue placeholder={isItalian ? "Scegli" : "Choose one"} />
                    </SelectTrigger>
                    <SelectContent className="border-cream/12 bg-charcoal/95 text-cream backdrop-blur-xl">
                      {inquiryTypes.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </Field>

              <Field label={isItalian ? "Note progetto" : "Project notes"} error={errors.details?.message}>
                <div className="glass-input">
                  <Textarea
                    {...register("details")}
                    rows={5}
                    placeholder={isItalian ? "Date, usage, formati richiesti, riferimenti." : "Shoot dates, usage, deliverable shapes, references."}
                    className={`${inputInner} min-h-[140px] resize-none py-3`}
                  />
                </div>
              </Field>

              <div className="grid gap-6 sm:grid-cols-2">
                <Field label="Timeline">
                  <div className="glass-input">
                    <Input {...register("timeline")} placeholder={isItalian ? "es. fine maggio" : "e.g. late May"} className={inputInner} />
                  </div>
                </Field>
                <Field label={isItalian ? "Budget indicativo" : "Budget band"}>
                  <div className="glass-input">
                    <Input {...register("budget")} placeholder="Optional" className={inputInner} />
                  </div>
                </Field>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="glass-button group mt-4 flex h-14 w-full items-center justify-center gap-3 sm:w-auto sm:min-w-[220px] sm:px-10 disabled:opacity-60"
              >
                {isSubmitting ? uiCopy.actions.sending : uiCopy.actions.sendInquiry}
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
};

const Field = ({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) => (
  <div className="space-y-2">
    <Label className="label-eyebrow">{label}</Label>
    {children}
    {error && <p className="font-sans text-[12px] text-destructive">{error}</p>}
  </div>
);

const ContactRow = ({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) => {
  const inner = (
    <div className="glass-chip group flex cursor-default items-center justify-between rounded-2xl px-4 py-4 transition-colors hover:bg-cream/[0.06]">
      <div className="flex items-center gap-4">
        <span className="text-bronze">{icon}</span>
        <span className="label-eyebrow">{label}</span>
      </div>
      <span className="font-sans text-sm text-cream/90 transition-colors group-hover:text-bronze">
        {value}
      </span>
    </div>
  );
  if (!href) return inner;
  const external = href.startsWith("http");
  return (
    <a
      href={href}
      className="block"
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {inner}
    </a>
  );
};
