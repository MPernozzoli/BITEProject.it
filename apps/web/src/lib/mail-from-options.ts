/**
 * Sender identities offered by the mail console. `/api/email/inbox` returns the
 * authoritative list (it comes from src/server/mail.ts), so this mirror is only
 * the offline fallback and what surfaces that don't load the mailbox — the
 * contact console — use to pick a From address.
 */

export type MailBrand = "bite_ordinary" | "bite_automatic" | "newsletter" | "transactional";

export type MailFromOption = {
  id: string;
  label: string;
  from: string;
  brand: MailBrand;
};

export const fallbackFromOptions: MailFromOption[] = [
  { id: "hello", label: "Hello", from: "BITE <hello@biteproject.it>", brand: "bite_ordinary" },
  { id: "massimo", label: "Massimo", from: "Massimo <massimo@biteproject.it>", brand: "bite_ordinary" },
  { id: "sami", label: "Sami", from: "Sami <sami@biteproject.it>", brand: "bite_ordinary" },
  { id: "pack", label: "Pack", from: "Pack <pack@biteproject.it>", brand: "bite_ordinary" },
  { id: "viaggi", label: "Viaggi", from: "Viaggi <viaggi@biteproject.it>", brand: "bite_ordinary" },
  { id: "support", label: "Support", from: "Support <support@biteproject.it>", brand: "bite_ordinary" },
];
