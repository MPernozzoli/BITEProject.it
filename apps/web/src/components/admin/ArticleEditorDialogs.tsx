import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface ArticleEditorDialogsProps {
  /** "Pubblica ora" oppure "pianifica": scelta al momento della pubblicazione. */
  publishChoiceOpen: boolean;
  setPublishChoiceOpen: (open: boolean) => void;
  handlePublishChoicePublishNow: () => void;
  handlePublishChoicePlanning: () => void;
  primaryPublishActionLabel: string;
  /** Uscita dalla pagina con modifiche non salvate. */
  leaveDialogOpen: boolean;
  leaveBusy: boolean;
  handleStayOnLeaveDialog: () => void;
  handleDiscardLeaveFromEditor: () => void;
  handleLeaveSaveDraft: () => void;
  handleLeavePublish: () => void;
  /** Offerta di traduzione quando mancano campi nell'altra lingua. */
  translationOfferOpen: boolean;
  translationOfferBusy: boolean;
  translationOfferLabels: string[];
  translationOfferPublishSkipLabel: string;
  pendingTranslationAction: "draft" | "publish" | null;
  handleTranslationOfferClose: () => void;
  handleTranslationOfferSkip: () => void;
  handleTranslationOfferTranslateAndContinue: () => void;
  saving: boolean;
  aiTranslating: boolean;
}

const ArticleEditorDialogs = ({
  publishChoiceOpen,
  setPublishChoiceOpen,
  handlePublishChoicePublishNow,
  handlePublishChoicePlanning,
  primaryPublishActionLabel,
  leaveDialogOpen,
  leaveBusy,
  handleStayOnLeaveDialog,
  handleDiscardLeaveFromEditor,
  handleLeaveSaveDraft,
  handleLeavePublish,
  translationOfferOpen,
  translationOfferBusy,
  translationOfferLabels,
  translationOfferPublishSkipLabel,
  pendingTranslationAction,
  handleTranslationOfferClose,
  handleTranslationOfferSkip,
  handleTranslationOfferTranslateAndContinue,
  saving,
  aiTranslating,
}: ArticleEditorDialogsProps) => {
  return (
    <>
    <AlertDialog open={publishChoiceOpen} onOpenChange={setPublishChoiceOpen}>
      <AlertDialogContent className="max-w-[560px] rounded-[28px] border-border bg-card shadow-lg">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="editorial-heading text-2xl leading-tight">Pubblicazione sul logbook</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="font-sans text-sm leading-relaxed text-foreground/72 space-y-3">
              <p>
                La programmazione in calendario (data e ora di uscita) avviene solo dal <strong>Piano editoriale</strong> in
                dashboard, non più da questo editor.
              </p>
              <p>
                <strong>Pubblica subito</strong> rende l&apos;articolo visibile sul logbook immediatamente. Sei sicuro di voler
                pubblicare adesso, senza passare dal piano?
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 sm:items-stretch">
          <Button
            type="button"
            className="w-full rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={saving}
            onClick={() => void handlePublishChoicePlanning()}
          >
            Manda in pianificazione
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            disabled={saving}
            onClick={() => void handlePublishChoicePublishNow()}
          >
            Pubblica subito
          </Button>
          <AlertDialogCancel type="button" className="mt-0 w-full rounded-full">
            Annulla
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={leaveDialogOpen}>
      <AlertDialogContent className="max-w-[560px] rounded-[28px] border-border bg-card shadow-lg">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="editorial-heading text-2xl leading-tight">Modifiche non salvate</AlertDialogTitle>
          <AlertDialogDescription className="font-sans text-sm leading-relaxed text-foreground/72">
            Ci sono modifiche non ancora salvate nell&apos;articolo. Scegli cosa fare prima di uscire.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 sm:items-stretch">
          <AlertDialogAction
            type="button"
            className="w-full rounded-full"
            disabled={saving || leaveBusy}
            onClick={(event) => {
              event.preventDefault();
              void handleLeaveSaveDraft();
            }}
          >
            {saving || leaveBusy ? "Salvataggio..." : "Salva come bozza (consigliato)"}
          </AlertDialogAction>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            disabled={saving || leaveBusy}
            onClick={() => void handleLeavePublish()}
          >
            {primaryPublishActionLabel}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={saving || leaveBusy}
            onClick={handleDiscardLeaveFromEditor}
          >
            Esci senza salvare
          </Button>
          <AlertDialogCancel type="button" className="mt-0 w-full rounded-full" onClick={handleStayOnLeaveDialog}>
            Annulla
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog
      open={translationOfferOpen}
      onOpenChange={(open) => {
        if (!open) handleTranslationOfferClose();
      }}
    >
      <AlertDialogContent className="max-w-[560px] rounded-[28px] border-border bg-card shadow-lg">
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="editorial-heading text-2xl leading-tight">Traduzioni mancanti</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="font-sans text-sm leading-relaxed text-foreground/72 space-y-3">
              <p>
                Prima di salvare risultano contenuti solo in una lingua. Vuoi generare automaticamente le parti mancanti
                (stesso comando &quot;Traduci campi vuoti&quot;) oppure procedere così com&apos;è?
              </p>
              {translationOfferLabels.length > 0 && (
                <ul className="list-disc pl-5 space-y-1 text-foreground/80">
                  {translationOfferLabels.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="flex flex-col gap-2 sm:items-stretch">
          <AlertDialogAction
            type="button"
            className="w-full rounded-full"
            disabled={saving || translationOfferBusy || aiTranslating}
            onClick={(event) => {
              event.preventDefault();
              void handleTranslationOfferTranslateAndContinue();
            }}
          >
            {translationOfferBusy || aiTranslating ? "Traduzione in corso…" : "Traduci e continua"}
          </AlertDialogAction>
          <Button
            type="button"
            variant="outline"
            className="w-full rounded-full"
            disabled={saving || translationOfferBusy || aiTranslating}
            onClick={() => void handleTranslationOfferSkip()}
          >
            {pendingTranslationAction === "publish" ? translationOfferPublishSkipLabel : "Salva bozza senza tradurre"}
          </Button>
          <AlertDialogCancel type="button" className="mt-0 w-full rounded-full">
            Annulla
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
};

export default ArticleEditorDialogs;
