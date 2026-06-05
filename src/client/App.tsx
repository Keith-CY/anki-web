import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Check,
  Download,
  FileDown,
  Home,
  Layers3,
  Loader2,
  LogOut,
  PauseCircle,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  SkipForward,
  Volume2,
  Sparkles,
  Trash2,
  UploadCloud,
  X
} from "lucide-react";
import clsx from "clsx";
import {
  ApiClient,
  type CardListPayload,
  type CardBrowserState,
  type Deck,
  type DeckPreset,
  type Draft,
  type GenerationPreview,
  type ImportJob,
  type JobRecord,
  type MediaAsset,
  type NoteTypeSummary,
  type ReviewCard,
  type ReviewNextPayload,
  type RuntimeSettings,
  type ReviewRating,
  type SettingsPreferences,
  type SourceRecord,
  type StatsPayload,
  type TagSummary
} from "./api";
import { sanitizeNoteTypeCss } from "./cardCss";
import {
  previewCoverageSummary,
  previewKindSummary,
  previewLanguageSummary,
  previewProviderLabel,
  previewTargetDeckLabel
} from "./generationPreviewViewModel";
import {
  canDownloadArchivedPackage,
  canExportGeneratedImport,
  canRetryImport,
  formatImportResult,
  formatImportUrl,
  studyMaterialTargetForImport
} from "./importHistory";
import { generationTargetFor, nextGenerationDeckSelection, type GenerationJlptSelection } from "./generationTarget";
import {
  buildJapaneseDraftUpdatePayload,
  createJapaneseCardEditorState,
  japaneseCardEditorFields,
  type JapaneseDraftEditorState,
  type JapaneseCardEditorFieldKey
} from "./japaneseCardEditor";
import { mediaActionErrorMessage, mediaAssetReference, mediaDeletedMessage, mediaUploadedMessage } from "./mediaLibrary";
import { deckPresetSummary, matchingDeckPresetId } from "./deckPresets";
import { confirmDestructiveAction } from "./destructiveActions";
import { deckPathLabel, deckTreeOptions, reparentDeckOptions } from "./deckHierarchy";
import { downloadFeedbackMessage, packageActionErrorMessage } from "./downloadFeedback";
import { draftAudioSource, draftAudioTitle } from "./draftAudio";
import { draftApprovalMessage, draftBulkApprovalDeckId, draftBulkTargetOptions, draftInboxQuery } from "./draftInbox";
import { buildManualJapaneseCardPayload, type ManualCardFocus } from "./japaneseCardForm";
import {
  newNoteTypeEditorState,
  noteTypeDeleteDisabledReason,
  noteTypeEditorState,
  noteTypePayloadFromEditor,
  type NoteTypeEditorState
} from "./noteTypeEditor";
import { noteTypeTemplateNames, noteTypeUsageText } from "./noteTypesViewModel";
import {
  defaultExportPackageOptions,
  defaultImportPackageOptions,
  exportPackageTitle,
  exportPackagePayload,
  importPackagePayload,
  type ExportPackageOptions,
  type ImportPackageOptions
} from "./packageOptions";
import { reviewAudioButtonLabel, reviewAudioText } from "./reviewAudio";
import {
  reviewElapsedMs,
  reviewKeyboardAction,
  reviewPreviewInterval,
  reviewRatingButtonState,
  reviewSchedulerSummary
} from "./reviewResult";
import { sourceLibraryRows } from "./sourceLibrary";
import {
  activityBars,
  calendarCells,
  cardStateRows,
  emptyStatsPayload,
  ratingRows,
  type ActivityBar,
  type CalendarCell,
  type StatsMetricRow
} from "./statsViewModel";
import { acceptedStudyMaterialFileTypes, studyMaterialUploadLabel } from "./studyMaterialPanel";
import { normalizeTagInput, tagDeleteMessage, tagRenameError, tagRenameMessage } from "./tagManagement";

type Tab = "study" | "decks" | "create" | "drafts" | "stats" | "settings";
const cardPageSize = 50;
const defaultSettingsPreferences: SettingsPreferences = {
  defaultJlptLevel: "mixed",
  packageImport: defaultImportPackageOptions,
  packageExport: defaultExportPackageOptions
};

export function App() {
  const api = useMemo(() => new ApiClient(), []);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("study");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.session().then((session) => setAuthenticated(session.authenticated)).catch(() => setAuthenticated(false));
  }, [api]);

  if (authenticated === null) {
    return <Splash />;
  }

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-panel">
          <div className="brand-mark">暗</div>
          <h1>Anki Web</h1>
          <p>Private Japanese study workspace</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setError(null);
              try {
                await api.login(password);
                setAuthenticated(true);
              } catch (loginError) {
                setError(loginError instanceof Error ? loginError.message : "Login failed");
              }
            }}
          >
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              aria-label="Instance password"
              placeholder="Instance password"
              autoFocus
            />
            <button type="submit">Unlock</button>
          </form>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      </main>
    );
  }

  return (
    <Shell
      tab={tab}
      setTab={setTab}
      onLogout={async () => {
        await api.logout();
        setAuthenticated(false);
      }}
    >
      <Workspace api={api} tab={tab} setTab={setTab} />
    </Shell>
  );
}

function Splash() {
  return (
    <main className="splash">
      <Loader2 className="spin" />
    </main>
  );
}

function Shell({
  tab,
  setTab,
  onLogout,
  children
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const tabs: Array<[Tab, React.ReactNode, string]> = [
    ["study", <Home />, "Study"],
    ["decks", <Layers3 />, "Decks"],
    ["create", <UploadCloud />, "Create"],
    ["drafts", <Sparkles />, "Drafts"],
    ["stats", <BarChart3 />, "Stats"],
    ["settings", <BookOpen />, "Settings"]
  ];
  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="logo">暗記</div>
        {tabs.map(([key, icon, label]) => (
          <button key={key} className={clsx("nav-button", tab === key && "active")} onClick={() => setTab(key)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
        <button className="nav-button logout" onClick={onLogout}>
          <LogOut />
          <span>Logout</span>
        </button>
      </aside>
      <section className="content">{children}</section>
      <nav className="bottom-nav">
        {tabs.slice(0, 5).map(([key, icon, label]) => (
          <button key={key} className={clsx(tab === key && "active")} onClick={() => setTab(key)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function Workspace({ api, tab, setTab }: { api: ApiClient; tab: Tab; setTab: (tab: Tab) => void }) {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckPresets, setDeckPresets] = useState<DeckPreset[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<string>("");
  const [generationDeckId, setGenerationDeckId] = useState<string | null>(null);
  const [generationJlptLevel, setGenerationJlptLevel] = useState<GenerationJlptSelection>("auto");
  const [dueCard, setDueCard] = useState<ReviewCard | null>(null);
  const [reviewPreviews, setReviewPreviews] = useState<ReviewNextPayload["previews"]>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [cards, setCards] = useState<ReviewCard[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftKindFilter, setDraftKindFilter] = useState("");
  const [draftPitchFilter, setDraftPitchFilter] = useState("");
  const [draftBulkTargetDeckId, setDraftBulkTargetDeckId] = useState("");
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview | null>(null);
  const [imports, setImports] = useState<ImportJob[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [noteTypes, setNoteTypes] = useState<NoteTypeSummary[]>([]);
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [tags, setTags] = useState<TagSummary[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [cardStateFilter, setCardStateFilter] = useState<CardBrowserState | "">("");
  const [cardPage, setCardPage] = useState<Pick<CardListPayload, "total" | "limit" | "offset" | "hasMore">>({
    total: 0,
    limit: cardPageSize,
    offset: 0,
    hasMore: false
  });
  const [stats, setStats] = useState<StatsPayload>(emptyStatsPayload);
  const [busy, setBusy] = useState(false);
  const [draftAudioBusy, setDraftAudioBusy] = useState(false);
  const [mediaUploadBusy, setMediaUploadBusy] = useState(false);
  const [reviewAudioBusy, setReviewAudioBusy] = useState(false);
  const [reviewStartedAt, setReviewStartedAt] = useState(() => performance.now());
  const [reviewSubmittingRating, setReviewSubmittingRating] = useState<ReviewRating | null>(null);
  const [lastReviewSummary, setLastReviewSummary] = useState<string | null>(null);
  const [lastReviewedCardId, setLastReviewedCardId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const generationDefaultJlptLevel = settings?.preferences.defaultJlptLevel ?? defaultSettingsPreferences.defaultJlptLevel;
  const effectiveGenerationDeckId = generationDeckId ?? "";
  const generationTarget = generationTargetFor(decks, effectiveGenerationDeckId, generationJlptLevel, generationDefaultJlptLevel);
  const generationTargetDeck = generationTarget.deckId ? decks.find((deck) => deck.id === generationTarget.deckId) ?? null : null;

  const selectDeck = (deckId: string) => {
    setSelectedDeck(deckId);
    setSelectedTag("");
    setCardSearch("");
    setCardStateFilter("");
    setCardPage((current) => ({ ...current, offset: 0 }));
  };

  const loadCards = async () => {
    const [cardPayload, tagPayload] = await Promise.all([
      api.cards(selectedDeck || undefined, selectedTag || undefined, cardSearch || undefined, {
        limit: cardPageSize,
        offset: cardPage.offset,
        state: cardStateFilter || undefined
      }),
      api.tags(selectedDeck || undefined)
    ]);
    setCards(cardPayload.cards);
    setCardPage({
      total: cardPayload.total,
      limit: cardPayload.limit,
      offset: cardPayload.offset,
      hasMore: cardPayload.hasMore
    });
    setTags(tagPayload.tags);
  };

  const refresh = async () => {
    const [
      deckPayload,
      presetPayload,
      nextPayload,
      draftPayload,
      statPayload,
      generationPreviewPayload,
      importPayload,
      jobPayload,
      mediaPayload,
      noteTypePayload,
      sourcePayload,
      settingsPayload
    ] = await Promise.all([
      api.decks(),
      api.deckPresets(),
      api.next(selectedDeck || undefined),
      api.drafts({
        ...draftInboxQuery({
          selectedStudyDeckId: selectedDeck || undefined,
          kind: draftKindFilter || undefined,
          pitchAccentStatus: draftPitchFilter || undefined
        })
      }),
      api.deckStats(selectedDeck || undefined),
      api.generationPreview(effectiveGenerationDeckId || undefined),
      api.imports(),
      api.jobs(),
      api.media(),
      api.noteTypes(),
      api.sources(),
      api.settings()
    ]);
    setDecks(deckPayload.decks);
    setDeckPresets(presetPayload.presets);
    setDueCard(nextPayload.card);
    setReviewPreviews(nextPayload.previews);
    setDrafts(draftPayload.drafts);
    setStats(statPayload);
    setGenerationPreview(generationPreviewPayload.preview);
    setImports(importPayload.imports);
    setJobs(jobPayload.jobs);
    setMediaAssets(mediaPayload.assets);
    setNoteTypes(noteTypePayload.noteTypes);
    setSources(sourcePayload.sources);
    setSettings(settingsPayload.settings);
    if (!selectedDeck && deckPayload.decks[0]) setSelectedDeck(deckPayload.decks[0].id);
    setGenerationDeckId((current) => nextGenerationDeckSelection(current, deckPayload.decks));
  };

  const submitReviewAnswer = async (rating: ReviewRating) => {
    if (!dueCard || reviewSubmittingRating) return;
    setReviewSubmittingRating(rating);
    setMessage(null);
    try {
      const result = await api.answer(dueCard.id, rating, reviewElapsedMs(reviewStartedAt));
      setLastReviewSummary(reviewSchedulerSummary(result));
      setLastReviewedCardId(dueCard.id);
      setShowAnswer(false);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review answer failed");
    } finally {
      setReviewSubmittingRating(null);
    }
  };

  useEffect(() => {
    refresh().catch((error) => setMessage(error instanceof Error ? error.message : "Failed to load"));
  }, [selectedDeck, draftKindFilter, draftPitchFilter, effectiveGenerationDeckId]);

  useEffect(() => {
    if (tab === "decks") loadCards().catch((error) => setMessage(error instanceof Error ? error.message : "Failed to load cards"));
  }, [api, selectedDeck, selectedTag, cardSearch, cardStateFilter, cardPage.offset, tab]);

  useEffect(() => {
    setReviewStartedAt(performance.now());
    setReviewSubmittingRating(null);
    setLastReviewSummary(null);
  }, [dueCard?.id]);

  useEffect(() => {
    if (tab !== "study" || !dueCard) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (reviewSubmittingRating) return;
      const action = reviewKeyboardAction(event, showAnswer);
      if (!action) return;
      event.preventDefault();
      if (action === "show-answer") {
        setShowAnswer(true);
        return;
      }
      void submitReviewAnswer(action);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dueCard?.id, reviewStartedAt, reviewSubmittingRating, showAnswer, tab]);

  const regenerateSourceDrafts = async (source: SourceRecord) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.regenerateSource(source.id, generationTarget);
      setMessage("Draft cards regenerated from stored source.");
      await refresh();
      setTab("drafts");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Regeneration failed");
    } finally {
      setBusy(false);
    }
  };

  const exportSourcePackage = async (source: SourceRecord) => {
    setMessage(null);
    try {
      const exported = await api.exportSource(source.id, exportPackagePayload(settings?.preferences.packageExport ?? defaultExportPackageOptions));
      const url = URL.createObjectURL(exported.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exported.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(downloadFeedbackMessage("source-export", exported.fileName));
    } catch (error) {
      setMessage(packageActionErrorMessage("source-export", error));
    }
  };

  const selectedStudyDeck = selectedDeck ? decks.find((deck) => deck.id === selectedDeck) ?? null : null;
  const studyDeckLabel = selectedStudyDeck ? deckPathLabel(selectedStudyDeck, decks) : "All decks";

  if (tab === "study") {
    return (
      <main className={clsx("study-screen", dueCard && "study-screen-session", showAnswer && "answer-visible")}>
        {dueCard ? (
          <StudySessionBar
            daily={stats.daily}
            deckLabel={studyDeckLabel}
            dueCount={stats.due}
            onExit={() => setTab("decks")}
          />
        ) : null}
        <Header title="Today" subtitle={`${stats.due} due · ${stats.drafts} drafts waiting`} />
        <DeckPicker decks={decks} value={selectedDeck} onChange={selectDeck} />
        {stats.daily ? <DailyProgress daily={stats.daily} /> : null}
        <section className={clsx("review-stage", dueCard && "active-review", showAnswer && "answer-visible")}>
          {dueCard ? (
            <>
              <CardHtml card={dueCard} side={showAnswer ? "answer" : "question"} />
              <div className="review-meta">
                <span>{dueCard.state}</span>
                <span>{dueCard.reps} reviews</span>
                <span>{dueCard.tags.join(", ") || "untagged"}</span>
              </div>
              <button
                className="secondary wide review-audio-button"
                disabled={reviewAudioBusy || !reviewAudioText(dueCard)}
                title={reviewAudioButtonLabel(dueCard)}
                onClick={async () => {
                  setReviewAudioBusy(true);
                  setMessage(null);
                  try {
                    const payload = await api.generateCardAudio(dueCard.id, reviewAudioText(dueCard));
                    setDueCard(payload.card);
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Audio generation failed");
                  } finally {
                    setReviewAudioBusy(false);
                  }
                }}
              >
                {reviewAudioBusy ? <Loader2 className="spin" /> : <Volume2 />}
                <span className="review-audio-label">{reviewAudioButtonLabel(dueCard)}</span>
              </button>
              {!showAnswer ? (
                <div className="review-action-stack review-controls">
                  <button className="primary wide" onClick={() => setShowAnswer(true)}>
                    Show answer
                  </button>
                  <button
                    className="secondary wide review-skip-button"
                    onClick={async () => {
                      setMessage(null);
                      try {
                        await api.buryReviewCard(dueCard.id);
                        setShowAnswer(false);
                        setLastReviewSummary("Card buried until tomorrow.");
                        await refresh();
                      } catch (error) {
                        setMessage(error instanceof Error ? error.message : "Bury failed");
                      }
                    }}
                  >
                    <SkipForward />
                    <span>Skip until tomorrow</span>
                  </button>
                </div>
              ) : (
                <div className="rating-grid review-controls">
                  {(["Again", "Hard", "Good", "Easy"] as const).map((rating) => {
                    const ratingState = reviewRatingButtonState(rating, reviewSubmittingRating);
                    return (
                      <button
                        key={rating}
                        className={clsx("rating", rating.toLowerCase())}
                        disabled={ratingState.disabled}
                        onClick={() => void submitReviewAnswer(rating)}
                      >
                        {ratingState.busy ? <Loader2 className="spin" /> : null}
                        {ratingState.label}
                        {reviewPreviews?.[rating] ? <small>{reviewPreviewInterval(reviewPreviews[rating])}</small> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <EmptyState title="No due cards" action="Create or import cards" onClick={() => setTab("create")} />
          )}
        </section>
        {lastReviewSummary ? (
          <div className="status-action-row">
            <p className="status-line">{lastReviewSummary}</p>
            {lastReviewedCardId ? (
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  setMessage(null);
                  try {
                    const result = await api.undoReviewAnswer(lastReviewedCardId);
                    setDueCard(result.card);
                    setShowAnswer(false);
                    setLastReviewSummary(`Undid ${result.undoneReview.rating}. Restored ${result.restoredSiblingCards} sibling cards.`);
                    setLastReviewedCardId(null);
                    await refresh();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Undo failed");
                  }
                }}
              >
                <RotateCcw />
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
        {message ? <p className="status-line">{message}</p> : null}
      </main>
    );
  }

  if (tab === "decks") {
    return (
      <main>
        <Header title="Decks" subtitle="Manage decks, cards, tags, and Japanese learning levels." />
        <section className="two-column">
          <div className="panel">
            <CreateDeckForm
              decks={decks}
              defaultLevel={settings?.preferences.defaultJlptLevel ?? defaultSettingsPreferences.defaultJlptLevel}
              onCreate={async (name, jlptLevel, parentId) => {
                const deck = await api.createDeck({ name, jlptLevel, parentId });
                selectDeck(deck.id);
                await refresh();
              }}
            />
            <DeckList decks={decks} selectedDeck={selectedDeck} onSelect={selectDeck} />
            <DeckSettingsForm
              decks={decks}
              deck={decks.find((deck) => deck.id === selectedDeck) ?? null}
              presets={deckPresets}
              defaultExportOptions={settings?.preferences.packageExport ?? defaultExportPackageOptions}
              onUpdate={async (input) => {
                if (!selectedDeck) return;
                await api.updateDeck(selectedDeck, input);
                await refresh();
              }}
              onDelete={async () => {
                if (!selectedDeck) return;
                const deck = decks.find((candidate) => candidate.id === selectedDeck);
                if (!confirmDestructiveAction("deck", deck?.name ?? selectedDeck)) return;
                await api.deleteDeck(selectedDeck);
                setSelectedDeck("");
                setSelectedTag("");
                setCards([]);
                setTags([]);
                await refresh();
              }}
              onUnbury={async () => {
                if (!selectedDeck) return;
                const result = await api.unburyDeck(selectedDeck);
                setMessage(`Restored ${result.restoredCards} buried cards.`);
                await refresh();
              }}
              onApplyPreset={async (presetId) => {
                if (!selectedDeck) return;
                const result = await api.applyDeckPreset(selectedDeck, presetId);
                setMessage(`Applied ${result.preset.name} preset.`);
                await refresh();
              }}
              onExport={async (options) => {
                if (!selectedDeck) return;
                setMessage(null);
                try {
                  const exported = await api.exportDeck(selectedDeck, exportPackagePayload(options));
                  const url = URL.createObjectURL(exported.blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = exported.fileName;
                  anchor.click();
                  URL.revokeObjectURL(url);
                  setMessage(downloadFeedbackMessage("deck-export", exported.fileName));
                } catch (error) {
                  setMessage(packageActionErrorMessage("deck-export", error));
                }
              }}
            />
          </div>
          <div className="panel">
            <CreateCardForm
              deckId={selectedDeck}
              noteTypes={noteTypes}
              onCreate={async (input) => {
                await api.createCard({ deckId: selectedDeck, ...input });
                await refresh();
                await loadCards();
              }}
            />
            <TagFilter
              tags={tags}
              selectedTag={selectedTag}
              onSelect={(tag) => {
                setSelectedTag(tag);
                setCardPage((current) => ({ ...current, offset: 0 }));
              }}
              onRename={async (tag, nextName) => {
                const normalizedName = normalizeTagInput(nextName);
                const result = await api.renameTag(tag.name, normalizedName, selectedDeck || undefined);
                if (selectedTag === tag.name) setSelectedTag(normalizedName);
                setCardPage((current) => ({ ...current, offset: 0 }));
                setMessage(tagRenameMessage(result.tag.name, result.updatedNotes));
                await refresh();
              }}
              onDelete={async (tag) => {
                if (!confirmDestructiveAction("tag", tag.name)) return;
                const result = await api.deleteTag(tag.name, selectedDeck || undefined);
                if (selectedTag === tag.name) setSelectedTag("");
                setCardPage((current) => ({ ...current, offset: 0 }));
                setMessage(tagDeleteMessage(result.removedTag, result.updatedNotes));
                await refresh();
              }}
              onBulkState={async (tag, action) => {
                const result = await api.bulkTagState(tag.name, action, selectedDeck || undefined);
                setMessage(`${action === "suspend" ? "Suspended" : "Restored"} ${result.updatedCards} cards tagged ${tag.name}.`);
                await refresh();
                await loadCards();
              }}
            />
            <CardSearch
              value={cardSearch}
              onChange={(search) => {
                setCardSearch(search);
                setCardPage((current) => ({ ...current, offset: 0 }));
              }}
            />
            <CardStateFilter
              value={cardStateFilter}
              onChange={(state) => {
                setCardStateFilter(state);
                setCardPage((current) => ({ ...current, offset: 0 }));
              }}
            />
            <CardTable
              cards={cards}
              decks={decks}
              page={cardPage}
              onPage={(offset) => setCardPage((current) => ({ ...current, offset }))}
              onUpdate={async (card, fields, tags, deckId) => {
                await api.updateCard(card.id, { fields, tags, deckId });
                await refresh();
                await loadCards();
              }}
              onAudio={async (card) => {
                await api.generateCardAudio(card.id, reviewAudioText(card));
                await loadCards();
              }}
              onSuspendToggle={async (card) => {
                if (card.state === "suspended") {
                  await api.unsuspendCard(card.id);
                } else {
                  await api.suspendCard(card.id);
                }
                await refresh();
                await loadCards();
              }}
              onReset={async (card) => {
                await api.resetCard(card.id);
                setMessage("Card review progress reset.");
                await refresh();
                await loadCards();
              }}
              onDelete={async (card) => {
                if (!confirmDestructiveAction("card", cardTitle(card))) return;
                await api.deleteCard(card.id);
                await refresh();
                await loadCards();
              }}
              onDeleteNote={async (card) => {
                if (!confirmDestructiveAction("note", cardTitle(card))) return;
                const result = await api.deleteNote(card.noteId);
                setMessage(`Deleted note and ${result.deletedCards} cards.`);
                await refresh();
                await loadCards();
              }}
            />
          </div>
        </section>
      </main>
    );
  }

  if (tab === "create") {
    return (
      <main>
        <Header title="Import & Generate" subtitle="Paste public .apkg/.colpkg URLs, article URLs, or Japanese study notes." />
        <GenerationTargetPanel
          decks={decks}
          deckId={effectiveGenerationDeckId}
          jlptLevel={generationJlptLevel}
          defaultJlptLevel={generationDefaultJlptLevel}
          onDeckChange={setGenerationDeckId}
          onJlptLevelChange={setGenerationJlptLevel}
        />
        <GenerationPreviewPanel
          preview={generationPreview}
          targetDeckName={generationTargetDeck?.name ?? null}
          targetJlptLevel={generationTarget.jlptLevel}
        />
        <section className="import-grid">
          <PackageImportPanel
            title="Import Anki package"
            placeholder="https://example.com/deck.apkg or collection.colpkg"
            action="Import package"
            busy={busy}
            defaultOptions={settings?.preferences.packageImport ?? defaultImportPackageOptions}
            onSubmit={async (url, options) => {
              setBusy(true);
              setMessage(null);
              try {
                const payload = importPackagePayload(url, options);
                await api.importApkg(payload.url, payload.includeScheduling);
                setMessage(
                  payload.includeScheduling
                    ? "Package imported with scheduling progress."
                    : "Package imported. Scheduling progress was stripped by default."
                );
                await refresh();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Import failed");
              } finally {
                setBusy(false);
              }
            }}
            onFileSubmit={async (file, options) => {
              setBusy(true);
              setMessage(null);
              try {
                await api.importApkgFile(file, options.includeScheduling);
                setMessage(
                  options.includeScheduling
                    ? "Package file imported with scheduling progress."
                    : "Package file imported. Scheduling progress was stripped by default."
                );
                await refresh();
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Import failed");
              } finally {
                setBusy(false);
              }
            }}
          />
          <UrlPanel
            title="Generate from article"
            placeholder="https://example.com/japanese-article"
            action="Create drafts"
            busy={busy}
            onSubmit={async (url) => {
              setBusy(true);
              setMessage(null);
              try {
                await api.generateFromUrl(
                  url,
                  generationTarget.deckId,
                  generationTarget.jlptLevel
                );
                setMessage("Draft cards created for review.");
                await refresh();
                setTab("drafts");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Generation failed");
              } finally {
                setBusy(false);
              }
            }}
          />
          <TextMaterialPanel
            busy={busy}
            onSubmit={async (title, text) => {
              setBusy(true);
              setMessage(null);
              try {
                await api.generateFromText({
                  title,
                  text,
                  deckId: generationTarget.deckId,
                  jlptLevel: generationTarget.jlptLevel
                });
                setMessage("Draft cards created from study notes.");
                await refresh();
                setTab("drafts");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Generation failed");
              } finally {
                setBusy(false);
              }
            }}
            onSubmitFile={async (title, files) => {
              setBusy(true);
              setMessage(null);
              try {
                await api.generateFromFiles(files, {
                  title,
                  deckId: generationTarget.deckId,
                  jlptLevel: generationTarget.jlptLevel
                });
                setMessage("Draft cards created from uploaded study materials.");
                await refresh();
                setTab("drafts");
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Generation failed");
              } finally {
                setBusy(false);
              }
            }}
          />
        </section>
        <ImportHistory
          jobs={imports}
          busy={busy}
          exportOptions={settings?.preferences.packageExport ?? defaultExportPackageOptions}
          onRetryImport={async (job) => {
            setBusy(true);
            setMessage(null);
            try {
              await api.retryImport(job.id);
              setMessage("Package import retried successfully.");
              await refresh();
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Retry failed");
            } finally {
              setBusy(false);
            }
          }}
          onDownloadArchived={async (job) => {
            setMessage(null);
            try {
              const archived = await api.downloadImportedPackage(job.id);
              const url = URL.createObjectURL(archived.blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = archived.fileName;
              anchor.click();
              URL.revokeObjectURL(url);
              setMessage(downloadFeedbackMessage("archived-import", archived.fileName));
            } catch (error) {
              setMessage(packageActionErrorMessage("archived-import", error));
            }
          }}
          onExportGenerated={async (job) => {
            setMessage(null);
            try {
              const exported = await api.exportImport(
                job.id,
                exportPackagePayload(settings?.preferences.packageExport ?? defaultExportPackageOptions)
              );
              const url = URL.createObjectURL(exported.blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = exported.fileName;
              anchor.click();
              URL.revokeObjectURL(url);
              setMessage(downloadFeedbackMessage("generated-import-export", exported.fileName));
            } catch (error) {
              setMessage(packageActionErrorMessage("generated-import-export", error));
            }
          }}
          onTargetStudyMaterial={(target) => {
            setGenerationDeckId(target.deckId);
            setGenerationJlptLevel("auto");
            setMessage(`Generation target set to ${target.deckName}: ${target.summary}.`);
          }}
        />
        <SourceLibrary
          sources={sources}
          busy={busy}
          exportOptions={settings?.preferences.packageExport ?? defaultExportPackageOptions}
          onRegenerateSource={regenerateSourceDrafts}
          onExportSource={exportSourcePackage}
        />
        {message ? <p className="status-line">{message}</p> : null}
      </main>
    );
  }

  if (tab === "drafts") {
    return (
      <main>
        <Header title="Draft Review" subtitle="AI-generated pitch accent remains review-required unless confirmed." />
        <section className="panel draft-toolbar">
          <div className="draft-filter-row">
            <span>{drafts.length} drafts waiting</span>
            <label>
              <span>Kind</span>
              <select value={draftKindFilter} onChange={(event) => setDraftKindFilter(event.target.value)}>
                <option value="">All kinds</option>
                <option value="vocabulary">Vocabulary</option>
                <option value="grammar">Grammar</option>
                <option value="pronunciation">Pronunciation</option>
              </select>
            </label>
            <label>
              <span>Pitch</span>
              <select value={draftPitchFilter} onChange={(event) => setDraftPitchFilter(event.target.value)}>
                <option value="">All pitch states</option>
                <option value="review-required">review-required</option>
                <option value="confirmed">confirmed</option>
              </select>
            </label>
            {drafts.length > 0 ? (
              <label>
                <span>Approve to</span>
                <select value={draftBulkTargetDeckId} onChange={(event) => setDraftBulkTargetDeckId(event.target.value)}>
                  {draftBulkTargetOptions(decks).map((option) => (
                    <option key={option.id || "preserve"} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {drafts.length > 0 ? (
            <div className="draft-toolbar-actions">
              <button
                type="button"
                disabled={draftAudioBusy}
                onClick={async () => {
                  setDraftAudioBusy(true);
                  setMessage(null);
                  try {
                    const result = await api.generateDraftAudios(drafts.map((draft) => draft.id));
                    setMessage(`Generated audio for ${result.generated} drafts. ${result.skipped} already had audio.`);
                    await refresh();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Bulk audio generation failed");
                  } finally {
                    setDraftAudioBusy(false);
                  }
                }}
              >
                {draftAudioBusy ? <Loader2 className="spin" /> : <Volume2 />}
                Generate audio
              </button>
              <button
                type="button"
                onClick={async () => {
                  setMessage(null);
                  try {
                    const result = await api.approveDrafts(
                      drafts.map((draft) => draft.id),
                      draftBulkApprovalDeckId({
                        selectedStudyDeckId: selectedDeck || undefined,
                        explicitTargetDeckId: draftBulkTargetDeckId
                      })
                    );
                    setMessage(draftApprovalMessage(result));
                    await refresh();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Bulk approval failed");
                  }
                }}
              >
                <Check />
                Approve all
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={async () => {
                  setMessage(null);
                  try {
                    const result = await api.rejectDrafts(drafts.map((draft) => draft.id));
                    setMessage(`Rejected ${result.rejected} drafts.`);
                    await refresh();
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : "Bulk rejection failed");
                  }
                }}
              >
                <X />
                Reject all
              </button>
            </div>
          ) : null}
        </section>
        <SourceLibrary
          title="Generated packages"
          emptyText="Approve generated drafts to export a source package."
          sources={sources}
          busy={busy}
          exportReadyOnly
          exportOptions={settings?.preferences.packageExport ?? defaultExportPackageOptions}
          onRegenerateSource={regenerateSourceDrafts}
          onExportSource={exportSourcePackage}
        />
        <section className="draft-list">
          {drafts.map((draft) => (
            <DraftCard
              key={draft.id}
              draft={draft}
              decks={decks}
              onSave={async (input) => {
                await api.updateDraft(draft.id, input);
                await refresh();
              }}
              onAudio={async () => {
                await api.generateDraftAudio(draft.id, draft.fields.Expression || draft.fields.Reading);
                await refresh();
              }}
              onApprove={async () => {
                const result = await api.approveDraft(draft.id);
                setMessage(draftApprovalMessage({ approved: 1, cardsCreated: result.cards.length, noteIds: [result.noteId] }));
                await refresh();
              }}
              onReject={async () => {
                await api.rejectDraft(draft.id);
                await refresh();
              }}
            />
          ))}
          {drafts.length === 0 ? <EmptyState title="No drafts" action="Generate from article" onClick={() => setTab("create")} /> : null}
        </section>
        {message ? <p className="status-line">{message}</p> : null}
      </main>
    );
  }

  if (tab === "stats") {
    return (
      <main>
        <Header title="Stats" subtitle="A compact view of collection and review load." />
        <section className="stat-grid">
          <Stat label="Due" value={stats.due} />
          <Stat label="Cards" value={stats.cards} />
          <Stat label="Reviews" value={stats.reviews} />
          <Stat label="Drafts" value={stats.drafts} />
        </section>
        <section className="stats-dashboard">
          <StatsBreakdown title="Card states" rows={cardStateRows(stats)} />
          <StatsBreakdown title="Answer ratings" rows={ratingRows(stats)} />
          <ActivitySummary bars={activityBars(stats)} />
          <ReviewCalendar cells={calendarCells(stats)} />
        </section>
      </main>
    );
  }

  return (
    <main>
      <Header title="Settings" subtitle="Coolify secrets configure password, OpenAI provider, models, and storage." />
      <RuntimeSettingsPanel settings={settings} />
      <SettingsPreferencesPanel
        preferences={settings?.preferences ?? null}
        onSave={async (preferences) => {
          const result = await api.updateSettingsPreferences(preferences);
          setSettings((current) => (current ? { ...current, preferences: result.preferences } : current));
          setMessage("Settings preferences saved.");
          await refresh();
        }}
      />
      <section className="panel settings-panel">
        <p>Set <code>APP_PASSWORD</code> or <code>APP_PASSWORD_HASH</code>, <code>SESSION_SECRET</code> with at least 32 characters, and optional OpenAI-compatible settings in Coolify.</p>
        <p>Persistent data must mount to <code>/data</code>. Exports remain package-based; AnkiWeb sync is intentionally disabled.</p>
      </section>
      <NoteTypeLibrary
        noteTypes={noteTypes}
        onCreate={async (state) => {
          await api.createNoteType(noteTypePayloadFromEditor(state));
          await refresh();
        }}
        onUpdate={async (noteType, state) => {
          const payload = noteTypePayloadFromEditor(state);
          await api.updateNoteType(
            noteType.id,
            noteType.noteCount > 0 || noteType.cardCount > 0
              ? { name: payload.name, css: payload.css }
              : payload
          );
          await refresh();
        }}
        onDelete={async (noteType) => {
          if (!confirmDestructiveAction("noteType", noteType.name)) return;
          await api.deleteNoteType(noteType.id);
          await refresh();
        }}
      />
      <JobHistory jobs={jobs} />
      <MediaLibrary
        assets={mediaAssets}
        uploadBusy={mediaUploadBusy}
        onUpload={async (file) => {
          setMediaUploadBusy(true);
          setMessage(null);
          try {
            const result = await api.uploadMedia(file);
            setMessage(mediaUploadedMessage(result.asset));
            await refresh();
          } catch (error) {
            setMessage(mediaActionErrorMessage("upload", error));
          } finally {
            setMediaUploadBusy(false);
          }
        }}
        onDelete={async (asset) => {
          if (!confirmDestructiveAction("media", asset.originalName)) return;
          setMessage(null);
          try {
            await api.deleteMedia(asset.id);
            setMessage(mediaDeletedMessage(asset));
            await refresh();
          } catch (error) {
            setMessage(mediaActionErrorMessage("delete", error));
          }
        }}
      />
    </main>
  );
}

function NoteTypeLibrary({
  noteTypes,
  onCreate,
  onUpdate,
  onDelete
}: {
  noteTypes: NoteTypeSummary[];
  onCreate: (state: NoteTypeEditorState) => Promise<void>;
  onUpdate: (noteType: NoteTypeSummary, state: NoteTypeEditorState) => Promise<void>;
  onDelete: (noteType: NoteTypeSummary) => Promise<void>;
}) {
  const [createState, setCreateState] = useState(() => newNoteTypeEditorState());
  const [editingId, setEditingId] = useState("");
  const [editState, setEditState] = useState<NoteTypeEditorState | null>(null);
  const [busyNoteTypeId, setBusyNoteTypeId] = useState("");

  const startEdit = (noteType: NoteTypeSummary) => {
    setEditingId(noteType.id);
    setEditState(noteTypeEditorState(noteType));
  };

  return (
    <section className="panel note-type-panel">
      <div className="section-heading">
        <h2>Note types</h2>
        <span>{noteTypes.length}</span>
      </div>
      <NoteTypeEditorForm
        title="Create custom note type"
        state={createState}
        onChange={setCreateState}
        onSubmit={async () => {
          setBusyNoteTypeId("new");
          try {
            await onCreate(createState);
            setCreateState(newNoteTypeEditorState());
          } finally {
            setBusyNoteTypeId("");
          }
        }}
        submitLabel="Create note type"
        busy={busyNoteTypeId === "new"}
      />
      {noteTypes.length === 0 ? (
        <p className="muted-text">No note types yet.</p>
      ) : (
        <div className="note-type-list">
          {noteTypes.map((noteType) => (
            <article key={noteType.id} className="note-type-row">
              {editingId === noteType.id && editState ? (
                <NoteTypeEditorForm
                  title={`Edit ${noteType.name}`}
                  state={editState}
                  onChange={setEditState}
                  definitionLocked={noteType.noteCount > 0 || noteType.cardCount > 0}
                  onSubmit={async () => {
                    setBusyNoteTypeId(noteType.id);
                    try {
                      await onUpdate(noteType, editState);
                      setEditingId("");
                      setEditState(null);
                    } finally {
                      setBusyNoteTypeId("");
                    }
                  }}
                  onCancel={() => {
                    setEditingId("");
                    setEditState(null);
                  }}
                  submitLabel="Save note type"
                  busy={busyNoteTypeId === noteType.id}
                />
              ) : (
                <>
                  <div>
                    <strong>{noteType.name}</strong>
                    <p>
                      {noteTypeUsageText(noteType)} · {noteType.hasCss ? "CSS" : "no CSS"}
                      {noteType.builtIn ? " · built-in" : ""}
                    </p>
                    <span>{noteType.fields.map((field) => field.name).join(", ")}</span>
                  </div>
                  <div className="note-type-template-list">
                    <span>{noteType.templates.length} templates</span>
                    <p>{noteTypeTemplateNames(noteType) || "No templates"}</p>
                    <div className="row-actions">
                      <button className="icon-button" title={`Edit ${noteType.name}`} onClick={() => startEdit(noteType)}>
                        <Pencil />
                      </button>
                      <button
                        className="icon-button danger"
                        title={noteTypeDeleteDisabledReason(noteType) || `Delete ${noteType.name}`}
                        disabled={Boolean(noteTypeDeleteDisabledReason(noteType)) || busyNoteTypeId === noteType.id}
                        onClick={async () => {
                          setBusyNoteTypeId(noteType.id);
                          try {
                            await onDelete(noteType);
                          } finally {
                            setBusyNoteTypeId("");
                          }
                        }}
                      >
                        <Trash2 />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function NoteTypeEditorForm({
  title,
  state,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  busy,
  definitionLocked = false
}: {
  title: string;
  state: NoteTypeEditorState;
  onChange: (state: NoteTypeEditorState) => void;
  onSubmit: () => Promise<void>;
  onCancel?: () => void;
  submitLabel: string;
  busy: boolean;
  definitionLocked?: boolean;
}) {
  const updateTemplate = (index: number, template: Partial<NoteTypeEditorState["templates"][number]>) => {
    onChange({
      ...state,
      templates: state.templates.map((existing, candidateIndex) =>
        candidateIndex === index ? { ...existing, ...template } : existing
      )
    });
  };
  return (
    <form
      className="note-type-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSubmit();
      }}
    >
      <h3>{title}</h3>
      <label>
        Name
        <input value={state.name} onChange={(event) => onChange({ ...state, name: event.target.value })} required />
      </label>
      <label>
        Fields
        <textarea
          value={state.fieldsText}
          onChange={(event) => onChange({ ...state, fieldsText: event.target.value })}
          disabled={definitionLocked}
          rows={4}
        />
      </label>
      <label>
        CSS
        <textarea value={state.css} onChange={(event) => onChange({ ...state, css: event.target.value })} rows={3} />
      </label>
      <div className="template-editor-list">
        {state.templates.map((template, index) => (
          <div className="template-editor" key={index}>
            <input
              value={template.name}
              onChange={(event) => updateTemplate(index, { name: event.target.value })}
              disabled={definitionLocked}
              placeholder="Template name"
              required
            />
            <textarea
              value={template.questionFormat}
              onChange={(event) => updateTemplate(index, { questionFormat: event.target.value })}
              disabled={definitionLocked}
              placeholder="Question HTML"
              rows={3}
              required
            />
            <textarea
              value={template.answerFormat}
              onChange={(event) => updateTemplate(index, { answerFormat: event.target.value })}
              disabled={definitionLocked}
              placeholder="Answer HTML"
              rows={3}
              required
            />
          </div>
        ))}
      </div>
      <div className="inline-actions">
        <button
          type="button"
          className="secondary"
          disabled={definitionLocked}
          onClick={() =>
            onChange({
              ...state,
              templates: [
                ...state.templates,
                {
                  name: `Card ${state.templates.length + 1}`,
                  questionFormat: "{{Expression}}",
                  answerFormat: "{{FrontSide}}<hr>{{Meaning}}"
                }
              ]
            })
          }
        >
          <Plus />
          Template
        </button>
        {onCancel ? (
          <button type="button" className="secondary" onClick={onCancel}>
            <X />
            Cancel
          </button>
        ) : null}
        <button type="submit" className="primary" disabled={busy || !state.name.trim()}>
          {busy ? <Loader2 className="spin" /> : <Save />}
          {submitLabel}
        </button>
      </div>
      {definitionLocked ? <p className="muted-text">Existing notes lock fields and templates; only name and CSS can be edited.</p> : null}
    </form>
  );
}

function RuntimeSettingsPanel({ settings }: { settings: RuntimeSettings | null }) {
  return (
    <section className="panel settings-panel runtime-settings">
      <div className="section-heading">
        <h2>Runtime</h2>
        <span>{settings ? settings.nodeEnv : "loading"}</span>
      </div>
      {settings ? (
        <div className="settings-grid">
          <SettingsRow label="Data directory" value={settings.storage.dataDir} />
          <SettingsRow label="Media directory" value={settings.storage.mediaDir} />
          <SettingsRow label="Package directory" value={settings.storage.packageDir} />
          <SettingsRow label="Database" value={settings.storage.databaseConfigured ? "configured" : "not configured"} />
          <SettingsRow label="OpenAI" value={settings.openai.configured ? "configured" : "not configured"} />
          <SettingsRow label="Base URL" value={settings.openai.baseUrlConfigured ? "custom" : "default"} />
          <SettingsRow label="Text model" value={settings.openai.textModel} />
          <SettingsRow label="TTS model" value={`${settings.openai.ttsModel} / ${settings.openai.ttsVoice}`} />
          <SettingsRow label="Generation provider" value={settings.providers.structuredGeneration} />
          <SettingsRow label="TTS provider" value={settings.providers.tts} />
          <SettingsRow
            label="Pitch accent lexicon"
            value={settings.japanese.pitchAccentLexiconSource ?? (settings.japanese.pitchAccentLexiconConfigured ? "configured" : "not configured")}
          />
        </div>
      ) : (
        <p className="muted-text">Loading runtime settings.</p>
      )}
    </section>
  );
}

function SettingsPreferencesPanel({
  preferences,
  onSave
}: {
  preferences: SettingsPreferences | null;
  onSave: (preferences: SettingsPreferences) => Promise<void>;
}) {
  const [state, setState] = useState<SettingsPreferences>(preferences ?? defaultSettingsPreferences);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setState(preferences ?? defaultSettingsPreferences);
  }, [preferences]);

  return (
    <form
      className="panel settings-panel preferences-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await onSave(state);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="section-heading">
        <h2>Preferences</h2>
        <span>saved locally</span>
      </div>
      <div className="settings-grid">
        <label className="settings-row">
          <span>Default JLPT</span>
          <select
            value={state.defaultJlptLevel}
            onChange={(event) => setState((current) => ({ ...current, defaultJlptLevel: event.target.value }))}
          >
            {["mixed", "N5", "N4", "N3", "N2", "N1"].map((level) => (
              <option key={level}>{level}</option>
            ))}
          </select>
        </label>
        <label className="settings-row option-row">
          <input
            type="checkbox"
            checked={state.packageImport.includeScheduling}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                packageImport: { includeScheduling: event.target.checked }
              }))
            }
          />
          Import review progress by default
        </label>
        <label className="settings-row option-row">
          <input
            type="checkbox"
            checked={state.packageExport.includeMedia}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                packageExport: { ...current.packageExport, includeMedia: event.target.checked }
              }))
            }
          />
          Export media by default
        </label>
        <label className="settings-row option-row">
          <input
            type="checkbox"
            checked={state.packageExport.includeScheduling}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                packageExport: { ...current.packageExport, includeScheduling: event.target.checked }
              }))
            }
          />
          Export review progress by default
        </label>
        <label className="settings-row option-row">
          <input
            type="checkbox"
            checked={state.packageExport.legacySupport}
            onChange={(event) =>
              setState((current) => ({
                ...current,
                packageExport: { ...current.packageExport, legacySupport: event.target.checked }
              }))
            }
          />
          Legacy package export by default
        </label>
      </div>
      <div className="button-row">
        <button type="submit" className="primary" disabled={busy || !preferences}>
          {busy ? <Loader2 className="spin" /> : <Save />}
          Save preferences
        </button>
      </div>
    </form>
  );
}

function SettingsRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JobHistory({ jobs }: { jobs: JobRecord[] }) {
  return (
    <section className="panel job-panel">
      <div className="section-heading">
        <h2>System jobs</h2>
        <span>{jobs.length} recent</span>
      </div>
      {jobs.length === 0 ? (
        <p className="muted-text">No jobs yet.</p>
      ) : (
        <div className="job-list">
          {jobs.slice(0, 8).map((job) => (
            <article key={job.id} className="job-row">
              <div>
                <strong>{job.type}</strong>
                <p>{jobSummary(job)}</p>
              </div>
              <span className={clsx("job-status", job.status)}>{job.status}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function jobSummary(job: JobRecord) {
  if (job.error) return job.error;
  if (typeof job.result?.draftsCreated === "number") return `${job.result.draftsCreated} drafts`;
  if (typeof job.result?.generated === "number") return `${job.result.generated} audio files`;
  if (typeof job.result?.notesImported === "number") return `${job.result.notesImported} notes imported`;
  return new Date(job.updatedAt).toLocaleString();
}

function MediaLibrary({
  assets,
  uploadBusy,
  onUpload,
  onDelete
}: {
  assets: MediaAsset[];
  uploadBusy: boolean;
  onUpload: (file: File) => Promise<void>;
  onDelete: (asset: MediaAsset) => Promise<void>;
}) {
  return (
    <section className="panel media-panel">
      <div className="section-heading">
        <h2>Media assets</h2>
        <div className="media-heading-actions">
          <span>{assets.length} files</span>
          <label className={clsx("file-upload-button", uploadBusy && "disabled")} title="Upload media">
            {uploadBusy ? <Loader2 className="spin" /> : <UploadCloud />}
            Upload
            <input
              type="file"
              accept="audio/*,image/png,image/jpeg,image/gif,image/webp,image/avif"
              disabled={uploadBusy}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0] ?? null;
                input.value = "";
                if (file) void onUpload(file);
              }}
            />
          </label>
        </div>
      </div>
      {assets.length === 0 ? (
        <p className="muted-text">No generated or imported media yet.</p>
      ) : (
        <div className="media-list">
          {assets.map((asset) => (
            <article key={asset.id} className="media-row">
              <div>
                <strong>{asset.originalName}</strong>
                <p>{asset.mimeType} · {asset.available ? "available" : "missing file"}</p>
                <code className="media-reference">{mediaAssetReference(asset)}</code>
              </div>
              <button title="Delete media" className="danger-button" onClick={() => onDelete(asset)}>
                <Trash2 />
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function GenerationTargetPanel({
  decks,
  deckId,
  jlptLevel,
  defaultJlptLevel,
  onDeckChange,
  onJlptLevelChange
}: {
  decks: Deck[];
  deckId: string;
  jlptLevel: GenerationJlptSelection;
  defaultJlptLevel: string;
  onDeckChange: (deckId: string) => void;
  onJlptLevelChange: (level: GenerationJlptSelection) => void;
}) {
  const target = generationTargetFor(decks, deckId, jlptLevel, defaultJlptLevel);
  return (
    <section className="panel generation-target-panel">
      <div>
        <h2>Generation target</h2>
        <p className="muted-text">
          Drafts will use {target.deckId ? "the selected deck" : "the generated default deck"} at {target.jlptLevel}.
        </p>
      </div>
      <label>
        <span>Deck</span>
        <select value={deckId} onChange={(event) => onDeckChange(event.target.value)}>
          <option value="">Generated default deck</option>
          {deckTreeOptions(decks).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label} · {option.deck.jlptLevel}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>JLPT</span>
        <select value={jlptLevel} onChange={(event) => onJlptLevelChange(event.target.value as GenerationJlptSelection)}>
          <option value="auto">Auto from deck/default</option>
          {["N5", "N4", "N3", "N2", "N1", "mixed"].map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}

function GenerationPreviewPanel({
  preview,
  targetDeckName,
  targetJlptLevel
}: {
  preview: GenerationPreview | null;
  targetDeckName: string | null;
  targetJlptLevel: string;
}) {
  return (
    <section className="panel generation-preview-panel">
      <div className="section-heading">
        <h2>Generation plan</h2>
        <span>{previewTargetDeckLabel(preview, targetDeckName)}</span>
      </div>
      {preview ? (
        <div className="generation-preview-grid">
          <SettingsRow label="JLPT target" value={targetJlptLevel} />
          <SettingsRow label="Card types" value={previewKindSummary(preview)} />
          <SettingsRow label="Languages" value={previewLanguageSummary(preview)} />
          <SettingsRow label="Provider" value={previewProviderLabel(preview)} />
          <SettingsRow label="Deck coverage" value={previewCoverageSummary(preview)} />
          <SettingsRow label="Note type" value={preview.outputNoteType} />
          <SettingsRow label="Max drafts" value={String(preview.maxDrafts)} />
          <SettingsRow
            label="Pitch accent"
            value={
              preview.pitchAccentPolicy.aiSourceRequiresReview
                ? `${preview.pitchAccentPolicy.field}: AI requires review`
                : `${preview.pitchAccentPolicy.field}: confirmed`
            }
          />
          <SettingsRow
            label="Pronunciation"
            value={
              preview.cardKinds.find((kind) => kind.kind === "pronunciation")?.approvalCreatesAllTemplates
                ? "approves all templates"
                : "single template"
            }
          />
        </div>
      ) : (
        <p className="muted-text">Loading generation plan.</p>
      )}
    </section>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </header>
  );
}

function DailyProgress({
  daily
}: {
  daily: { newDone: number; newLimit: number; reviewDone: number; reviewLimit: number };
}) {
  return (
    <div className="daily-progress">
      <span>New {daily.newDone}/{daily.newLimit}</span>
      <span>Review {daily.reviewDone}/{daily.reviewLimit}</span>
    </div>
  );
}

function StudySessionBar({
  daily,
  deckLabel,
  dueCount,
  onExit
}: {
  daily: StatsPayload["daily"];
  deckLabel: string;
  dueCount: number;
  onExit: () => void;
}) {
  const dailyDone = daily ? daily.newDone + daily.reviewDone : 0;
  const dailyLimit = daily ? daily.newLimit + daily.reviewLimit : 0;
  const progress = dailyLimit > 0 ? Math.min(100, Math.round((dailyDone / dailyLimit) * 100)) : dueCount > 0 ? 0 : 100;
  const progressLabel = dailyLimit > 0 ? `${dailyDone}/${dailyLimit} today` : dueCount > 0 ? `${dueCount} remaining` : "Complete";

  return (
    <div className="mobile-study-bar" aria-label="Study session">
      <button type="button" className="secondary mobile-study-exit" onClick={onExit} aria-label="Back to decks">
        <ChevronLeft />
        <span>Decks</span>
      </button>
      <div className="mobile-study-status">
        <strong>{deckLabel}</strong>
        <span>{progressLabel}</span>
        <div className="mobile-study-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </div>
      <div className="mobile-study-count" aria-label={`${dueCount} due cards`}>
        <strong>{dueCount}</strong>
        <span>due</span>
      </div>
    </div>
  );
}

function DeckPicker({ decks, value, onChange }: { decks: Deck[]; value: string; onChange: (id: string) => void }) {
  const options = deckTreeOptions(decks);
  return (
    <select className="deck-picker" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">All decks</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label} · {option.deck.jlptLevel}
        </option>
      ))}
    </select>
  );
}

function TextMaterialPanel({
  busy,
  onSubmit,
  onSubmitFile
}: {
  busy: boolean;
  onSubmit: (title: string, text: string) => Promise<void>;
  onSubmitFile: (title: string, files: File[]) => Promise<void>;
}) {
  const [title, setTitle] = useState("Study notes");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const canSubmit = title.trim().length > 0 && text.trim().length >= 20 && !busy;
  const canSubmitFile = title.trim().length > 0 && files.length > 0 && !busy;
  return (
    <form
      className="text-panel panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit) return;
        await onSubmit(title.trim(), text.trim());
        setText("");
      }}
    >
      <h2>Generate from notes</h2>
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Material title" />
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="今日は学校で新しい文法を勉強しました..."
      />
      <div className="button-row">
        <button disabled={!canSubmit}>
          {busy ? <Loader2 className="spin" /> : <Sparkles />}
          Create drafts
        </button>
      </div>
      <label className="file-upload-row">
        <span>{studyMaterialUploadLabel(files.length)}</span>
        <input
          type="file"
          multiple
          accept={acceptedStudyMaterialFileTypes}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      <button
        type="button"
        disabled={!canSubmitFile}
        onClick={async () => {
          if (!canSubmitFile) return;
          await onSubmitFile(title.trim(), files);
          setFiles([]);
        }}
      >
        {busy ? <Loader2 className="spin" /> : <UploadCloud />}
        Create drafts from files
      </button>
    </form>
  );
}

function ImportHistory({
  jobs,
  busy,
  exportOptions,
  onRetryImport,
  onDownloadArchived,
  onExportGenerated,
  onTargetStudyMaterial
}: {
  jobs: ImportJob[];
  busy: boolean;
  exportOptions: ExportPackageOptions;
  onRetryImport: (job: ImportJob) => Promise<void>;
  onDownloadArchived: (job: ImportJob) => Promise<void>;
  onExportGenerated: (job: ImportJob) => Promise<void>;
  onTargetStudyMaterial: (target: { deckId: string; deckName: string; summary: string }) => void;
}) {
  return (
    <section className="panel import-history">
      <div className="section-heading">
        <h2>Recent imports</h2>
        <span>{jobs.length}</span>
      </div>
      {jobs.length === 0 ? (
        <p className="muted-text">No import jobs yet.</p>
      ) : (
        <div className="import-job-list">
          {jobs.slice(0, 8).map((job) => {
            const studyMaterialTarget = studyMaterialTargetForImport(job);
            return (
              <article key={job.id} className="import-job">
                <div>
                  <strong>{job.type}</strong>
                  <span className="job-url">{formatImportUrl(job)}</span>
                </div>
                <div className="job-meta">
                  <span className={clsx("job-status", job.status)}>{job.status}</span>
                  <span>{formatImportResult(job)}</span>
                  <time>{new Date(job.updatedAt).toLocaleString()}</time>
                  {studyMaterialTarget ? (
                    <button
                      type="button"
                      title={`Target ${studyMaterialTarget.deckName} for study material`}
                      onClick={() => onTargetStudyMaterial(studyMaterialTarget)}
                    >
                      <Sparkles />
                    </button>
                  ) : null}
                  {canRetryImport(job) ? (
                    <button type="button" title="Retry package import" disabled={busy} onClick={() => onRetryImport(job)}>
                      {busy ? <Loader2 className="spin" /> : <RotateCcw />}
                    </button>
                  ) : null}
                  {canDownloadArchivedPackage(job) ? (
                    <button type="button" title="Download original package" onClick={() => onDownloadArchived(job)}>
                      <Download />
                    </button>
                  ) : null}
                  {canExportGeneratedImport(job) ? (
                    <button type="button" title={exportPackageTitle("Export generated cards", exportOptions)} onClick={() => onExportGenerated(job)}>
                      <FileDown />
                    </button>
                  ) : null}
                </div>
                {job.error ? <p className="error-text">{job.error}</p> : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function SourceLibrary({
  title = "Learning sources",
  emptyText = "No learning sources yet.",
  sources,
  busy,
  exportReadyOnly = false,
  exportOptions,
  onRegenerateSource,
  onExportSource
}: {
  title?: string;
  emptyText?: string;
  sources: SourceRecord[];
  busy: boolean;
  exportReadyOnly?: boolean;
  exportOptions: ExportPackageOptions;
  onRegenerateSource: (source: SourceRecord) => Promise<void>;
  onExportSource: (source: SourceRecord) => Promise<void>;
}) {
  const rows = sourceLibraryRows(sources, { exportReadyOnly });
  return (
    <section className="panel source-history">
      <div className="section-heading">
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted-text">{emptyText}</p>
      ) : (
        <div className="source-list">
          {rows.slice(0, 8).map(({ source, originLabel, canExport }) => (
            <article key={source.id} className="source-row">
              <div>
                <strong>{source.title}</strong>
                <p>{source.contentPreview}</p>
                <span className="job-url">{originLabel}</span>
              </div>
              <div className="source-counts">
                <span>{source.drafts.draft} drafts</span>
                <span>{source.approvedNotes} approved</span>
                <time>{new Date(source.createdAt).toLocaleDateString()}</time>
                <button type="button" title="Regenerate draft cards" disabled={busy} onClick={() => onRegenerateSource(source)}>
                  {busy ? <Loader2 className="spin" /> : <Sparkles />}
                </button>
                <button
                  type="button"
                  title={exportPackageTitle("Export approved cards", exportOptions)}
                  disabled={!canExport}
                  onClick={() => onExportSource(source)}
                >
                  <FileDown />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CreateDeckForm({
  decks,
  defaultLevel,
  onCreate
}: {
  decks: Deck[];
  defaultLevel: string;
  onCreate: (name: string, jlptLevel: string, parentId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [level, setLevel] = useState(defaultLevel);
  const [parentId, setParentId] = useState("");
  const parentOptions = deckTreeOptions(decks);

  useEffect(() => {
    setLevel(defaultLevel);
  }, [defaultLevel]);

  return (
    <form
      className="inline-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim()) return;
        await onCreate(name, level, parentId || null);
        setName("");
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Deck name" />
      <select value={parentId} onChange={(event) => setParentId(event.target.value)} title="Parent deck">
        <option value="">Top level</option>
        {parentOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
      <select value={level} onChange={(event) => setLevel(event.target.value)}>
        {["N5", "N4", "N3", "N2", "N1", "mixed"].map((levelOption) => (
          <option key={levelOption}>{levelOption}</option>
        ))}
      </select>
      <button title="Create deck">
        <Plus />
      </button>
    </form>
  );
}

function DeckList({ decks, selectedDeck, onSelect }: { decks: Deck[]; selectedDeck: string; onSelect: (id: string) => void }) {
  const options = deckTreeOptions(decks);
  return (
    <div className="deck-list">
      {options.map((option) => (
        <button
          key={option.id}
          className={clsx(selectedDeck === option.id && "active")}
          style={{ paddingLeft: `${12 + option.depth * 16}px` }}
          onClick={() => onSelect(option.id)}
        >
          <span>{option.deck.name}</span>
          <small>{option.deck.jlptLevel}</small>
        </button>
      ))}
    </div>
  );
}

function TagFilter({
  tags,
  selectedTag,
  onSelect,
  onRename,
  onDelete,
  onBulkState
}: {
  tags: TagSummary[];
  selectedTag: string;
  onSelect: (tag: string) => void;
  onRename: (tag: TagSummary, nextName: string) => Promise<void>;
  onDelete: (tag: TagSummary) => Promise<void>;
  onBulkState: (tag: TagSummary, action: "suspend" | "unsuspend") => Promise<void>;
}) {
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [nextName, setNextName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (tags.length === 0) return null;
  return (
    <div className="tag-manager">
      <button type="button" className={clsx(!selectedTag && "active")} onClick={() => onSelect("")}>
        All
      </button>
      <div className="tag-filter">
        {tags.map((tag) => (
          <div key={tag.name} className={clsx("tag-chip", selectedTag === tag.name && "active")}>
            {editingTag === tag.name ? (
              <form
                className="tag-edit"
                onSubmit={async (event) => {
                  event.preventDefault();
                  const renameError = tagRenameError(tag.name, nextName);
                  if (renameError) {
                    setError(renameError);
                    return;
                  }
                  await onRename(tag, nextName);
                  setEditingTag(null);
                  setNextName("");
                  setError(null);
                }}
              >
                <input value={nextName} onChange={(event) => setNextName(event.target.value)} aria-label={`Rename ${tag.name}`} autoFocus />
                <button title="Save tag" type="submit">
                  <Check />
                </button>
                <button title="Cancel tag edit" type="button" onClick={() => setEditingTag(null)}>
                  <X />
                </button>
              </form>
            ) : (
              <>
                <button type="button" className="tag-select" onClick={() => onSelect(tag.name)}>
                  {tag.name} <span>{tag.count}</span>
                </button>
                <button
                  type="button"
                  title={`Rename ${tag.name}`}
                  className="tag-icon"
                  onClick={() => {
                    setEditingTag(tag.name);
                    setNextName(tag.name);
                    setError(null);
                  }}
                >
                  <Pencil />
                </button>
                <button type="button" title={`Delete ${tag.name}`} className="tag-icon danger-inline" onClick={() => onDelete(tag)}>
                  <Trash2 />
                </button>
                <button type="button" title={`Suspend cards tagged ${tag.name}`} className="tag-icon" onClick={() => onBulkState(tag, "suspend")}>
                  <PauseCircle />
                </button>
                <button type="button" title={`Restore cards tagged ${tag.name}`} className="tag-icon" onClick={() => onBulkState(tag, "unsuspend")}>
                  <RotateCcw />
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}

function CardSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="card-search">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search expression, reading, meaning, example, or tag"
      />
      {value ? (
        <button title="Clear search" type="button" onClick={() => onChange("")}>
          <X />
        </button>
      ) : null}
    </div>
  );
}

function CardStateFilter({ value, onChange }: { value: CardBrowserState | ""; onChange: (value: CardBrowserState | "") => void }) {
  const states: Array<[CardBrowserState | "", string]> = [
    ["", "All states"],
    ["new", "New"],
    ["learning", "Learning"],
    ["review", "Review"],
    ["relearning", "Relearning"],
    ["suspended", "Suspended"]
  ];
  return (
    <div className="card-state-filter">
      {states.map(([state, label]) => (
        <button key={state || "all"} type="button" className={clsx(value === state && "active")} onClick={() => onChange(state)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function DeckSettingsForm({
  decks,
  deck,
  presets,
  defaultExportOptions,
  onUpdate,
  onDelete,
  onUnbury,
  onApplyPreset,
  onExport
}: {
  decks: Deck[];
  deck: Deck | null;
  presets: DeckPreset[];
  defaultExportOptions: ExportPackageOptions;
  onUpdate: (input: Partial<Pick<Deck, "name" | "parentId" | "jlptLevel" | "dailyNewLimit" | "dailyReviewLimit" | "fsrsRetention">>) => Promise<void>;
  onDelete: () => Promise<void>;
  onUnbury: () => Promise<void>;
  onApplyPreset: (presetId: string) => Promise<void>;
  onExport: (options: ExportPackageOptions) => Promise<void>;
}) {
  const [name, setName] = useState(deck?.name ?? "");
  const [level, setLevel] = useState(deck?.jlptLevel ?? "mixed");
  const [dailyNewLimit, setDailyNewLimit] = useState(deck?.dailyNewLimit ?? 20);
  const [dailyReviewLimit, setDailyReviewLimit] = useState(deck?.dailyReviewLimit ?? 200);
  const [fsrsRetention, setFsrsRetention] = useState(deck?.fsrsRetention ?? 0.9);
  const [parentId, setParentId] = useState(deck?.parentId ?? "");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [includeMedia, setIncludeMedia] = useState(defaultExportOptions.includeMedia);
  const [includeScheduling, setIncludeScheduling] = useState(defaultExportOptions.includeScheduling);
  const [legacySupport, setLegacySupport] = useState(defaultExportOptions.legacySupport);

  useEffect(() => {
    setName(deck?.name ?? "");
    setLevel(deck?.jlptLevel ?? "mixed");
    setDailyNewLimit(deck?.dailyNewLimit ?? 20);
    setDailyReviewLimit(deck?.dailyReviewLimit ?? 200);
    setFsrsRetention(deck?.fsrsRetention ?? 0.9);
    setParentId(deck?.parentId ?? "");
  }, [deck]);

  useEffect(() => {
    setSelectedPreset(matchingDeckPresetId(deck, presets));
  }, [deck, presets]);

  useEffect(() => {
    setIncludeMedia(defaultExportOptions.includeMedia);
    setIncludeScheduling(defaultExportOptions.includeScheduling);
    setLegacySupport(defaultExportOptions.legacySupport);
  }, [defaultExportOptions.includeMedia, defaultExportOptions.includeScheduling, defaultExportOptions.legacySupport]);

  if (!deck) return null;
  const activePreset = presets.find((preset) => preset.id === selectedPreset);
  const parentOptions = reparentDeckOptions(decks, deck.id);

  return (
    <form
      className="deck-settings"
      onSubmit={async (event) => {
        event.preventDefault();
        await onUpdate({ name, parentId: parentId || null, jlptLevel: level, dailyNewLimit, dailyReviewLimit, fsrsRetention });
      }}
    >
      <h2>Deck settings</h2>
      <input value={name} onChange={(event) => setName(event.target.value)} />
      <label>
        Parent deck
        <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
          <option value="">Top level</option>
          {parentOptions.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <select value={level} onChange={(event) => setLevel(event.target.value)}>
        {["N5", "N4", "N3", "N2", "N1", "mixed"].map((levelOption) => (
          <option key={levelOption}>{levelOption}</option>
        ))}
      </select>
      <div className="limit-grid">
        <label>
          New/day
          <input type="number" min={0} value={dailyNewLimit} onChange={(event) => setDailyNewLimit(Number(event.target.value))} />
        </label>
        <label>
          Reviews/day
          <input
            type="number"
            min={0}
            value={dailyReviewLimit}
            onChange={(event) => setDailyReviewLimit(Number(event.target.value))}
          />
        </label>
      </div>
      <label>
        FSRS retention
        <input
          type="number"
          min={0.7}
          max={0.99}
          step={0.01}
          value={fsrsRetention}
          onChange={(event) => setFsrsRetention(Number(event.target.value))}
        />
      </label>
      {presets.length > 0 ? (
        <div className="preset-row">
          <label>
            Preset
            <select value={selectedPreset} onChange={(event) => setSelectedPreset(event.target.value)}>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <button title="Apply preset" type="button" disabled={!selectedPreset} onClick={() => onApplyPreset(selectedPreset)}>
            <Check />
          </button>
          {activePreset ? <small>{deckPresetSummary(activePreset)}</small> : null}
        </div>
      ) : null}
      <div className="option-stack">
        <label className="option-row">
          <input type="checkbox" checked={includeMedia} onChange={(event) => setIncludeMedia(event.target.checked)} />
          Include media
        </label>
        <label className="option-row">
          <input type="checkbox" checked={includeScheduling} onChange={(event) => setIncludeScheduling(event.target.checked)} />
          Include review progress
        </label>
        <label className="option-row">
          <input type="checkbox" checked={legacySupport} onChange={(event) => setLegacySupport(event.target.checked)} />
          Legacy .apkg support
        </label>
      </div>
      <div className="button-row">
        <button title="Save deck" type="submit">
          <Save />
        </button>
        <button
          title={exportPackageTitle("Export deck", { legacySupport })}
          type="button"
          onClick={() => onExport({ includeMedia, includeScheduling, legacySupport })}
        >
          <Download />
        </button>
        <button title="Unbury cards" type="button" onClick={onUnbury}>
          <RotateCcw />
        </button>
        <button title="Delete deck" type="button" className="danger-button" onClick={onDelete}>
          <Trash2 />
        </button>
      </div>
    </form>
  );
}

function DraftCard({
  draft,
  decks,
  onSave,
  onAudio,
  onApprove,
  onReject
}: {
  draft: Draft;
  decks: Deck[];
  onSave: (input: ReturnType<typeof buildJapaneseDraftUpdatePayload>) => Promise<void>;
  onAudio: () => Promise<void>;
  onApprove: () => Promise<void>;
  onReject: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editorState, setEditorState] = useState<JapaneseDraftEditorState>(() => createDraftEditorState(draft));
  const audioSource = draftAudioSource(draft.fields);

  useEffect(() => {
    setEditorState(createDraftEditorState(draft));
  }, [draft]);

  const updateField = (key: JapaneseCardEditorFieldKey, value: string) => {
    setEditorState((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [key]: value
      }
    }));
  };

  if (editing) {
    return (
      <form
        className="draft-card draft-editor card-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          await onSave(buildJapaneseDraftUpdatePayload(editorState));
          setEditing(false);
        }}
      >
        <label>
          <span>Kind</span>
          <select
            value={editorState.kind}
            onChange={(event) =>
              setEditorState((current) => ({ ...current, kind: event.target.value as JapaneseDraftEditorState["kind"] }))
            }
          >
            <option value="vocabulary">Vocabulary</option>
            <option value="grammar">Grammar</option>
            <option value="pronunciation">Pronunciation</option>
          </select>
        </label>
        <label>
          <span>Target deck</span>
          <select
            value={editorState.deckId}
            onChange={(event) => setEditorState((current) => ({ ...current, deckId: event.target.value }))}
          >
            <option value="">Default deck on approval</option>
            {deckTreeOptions(decks).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} · {option.deck.jlptLevel}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Pitch status</span>
          <select
            value={editorState.pitchAccentStatus}
            onChange={(event) =>
              setEditorState((current) => ({
                ...current,
                pitchAccentStatus: event.target.value as JapaneseDraftEditorState["pitchAccentStatus"]
              }))
            }
          >
            <option value="review-required">review-required</option>
            <option value="confirmed">confirmed</option>
          </select>
        </label>
        {japaneseCardEditorFields.map((field) => (
          <label key={field.key} className={clsx(field.multiline && "wide-field")}>
            <span>{field.label}</span>
            {field.multiline ? (
              <textarea value={editorState.fields[field.key]} onChange={(event) => updateField(field.key, event.target.value)} />
            ) : (
              <input value={editorState.fields[field.key]} onChange={(event) => updateField(field.key, event.target.value)} />
            )}
          </label>
        ))}
        <label className="wide-field">
          <span>Tags</span>
          <input
            value={editorState.tags}
            onChange={(event) => setEditorState((current) => ({ ...current, tags: event.target.value }))}
            placeholder="grammar, N4"
          />
        </label>
        <div className="draft-actions wide-field">
          <button title="Save draft" type="submit">
            <Save />
          </button>
          <button title="Cancel" type="button" onClick={() => setEditing(false)}>
            <X />
          </button>
        </div>
      </form>
    );
  }

  return (
    <article className="draft-card">
      <div>
        <div className="pill">{draft.kind}</div>
        <h3>{draft.front}</h3>
        <p>{draft.back}</p>
        <p className="muted-text">{draftDeckLabel(draft, decks)}</p>
        {audioSource ? <audio className="draft-audio" controls src={audioSource} /> : null}
        <span className={clsx(draft.pitchAccentStatus === "confirmed" ? "confirmed" : "warning")}>{draft.pitchAccentStatus}</span>
      </div>
      <div className="draft-actions">
        <button title={draftAudioTitle(draft.fields)} onClick={onAudio}>
          <Volume2 />
        </button>
        <button title="Edit draft" onClick={() => setEditing(true)}>
          <Pencil />
        </button>
        <button title="Approve" onClick={onApprove}>
          <Check />
        </button>
        <button title="Reject" onClick={onReject}>
          <X />
        </button>
      </div>
    </article>
  );
}

function getDraftTags(draft: Draft) {
  const tags = draft.raw.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === "string") : [];
}

function createDraftEditorState(draft: Draft): JapaneseDraftEditorState {
  const base = createJapaneseCardEditorState(draft.fields, getDraftTags(draft));
  return {
    ...base,
    kind: normalizeDraftKind(draft.kind),
    pitchAccentStatus: normalizePitchAccentStatus(draft.pitchAccentStatus),
    deckId: draft.deckId ?? ""
  };
}

function normalizeDraftKind(value: string): JapaneseDraftEditorState["kind"] {
  if (value === "grammar" || value === "pronunciation") return value;
  return "vocabulary";
}

function normalizePitchAccentStatus(value: string): JapaneseDraftEditorState["pitchAccentStatus"] {
  return value === "confirmed" ? "confirmed" : "review-required";
}

function draftDeckLabel(draft: Draft, decks: Deck[]) {
  const deck = decks.find((candidate) => candidate.id === draft.deckId);
  if (deck) return `Target: ${deckPathLabel(deck, decks)}`;
  return "Target: default deck";
}

function CreateCardForm({
  deckId,
  noteTypes,
  onCreate
}: {
  deckId: string;
  noteTypes: NoteTypeSummary[];
  onCreate: (input: {
    noteTypeId?: string;
    fields: Record<string, string>;
    tags: string[];
    createAllTemplates?: boolean;
    templateNames?: string[];
  }) => Promise<void>;
}) {
  const [noteTypeId, setNoteTypeId] = useState("");
  const [expression, setExpression] = useState("");
  const [reading, setReading] = useState("");
  const [pitchAccent, setPitchAccent] = useState("");
  const [meaningZh, setMeaningZh] = useState("");
  const [meaningEn, setMeaningEn] = useState("");
  const [meaningJa, setMeaningJa] = useState("");
  const [example, setExample] = useState("");
  const [explanationZh, setExplanationZh] = useState("");
  const [explanationEn, setExplanationEn] = useState("");
  const [explanationJa, setExplanationJa] = useState("");
  const [audio, setAudio] = useState("");
  const [focus, setFocus] = useState<ManualCardFocus>("vocabulary");
  const [tags, setTags] = useState("");
  const [customFields, setCustomFields] = useState<Record<string, string>>({});
  const selectedNoteType = noteTypes.find((noteType) => noteType.id === noteTypeId) ?? noteTypes.find((noteType) => noteType.builtIn) ?? null;
  const isJapaneseNoteType = !selectedNoteType || selectedNoteType.builtIn;

  useEffect(() => {
    if (!noteTypes.length) return;
    if (noteTypeId && noteTypes.some((noteType) => noteType.id === noteTypeId)) return;
    setNoteTypeId(noteTypes.find((noteType) => noteType.builtIn)?.id ?? noteTypes[0].id);
  }, [noteTypeId, noteTypes]);

  useEffect(() => {
    setCustomFields(Object.fromEntries((selectedNoteType?.fields ?? []).map((field) => [field.name, ""])));
  }, [selectedNoteType?.id]);

  const resetJapaneseFields = () => {
    setExpression("");
    setReading("");
    setPitchAccent("");
    setMeaningZh("");
    setMeaningEn("");
    setMeaningJa("");
    setExample("");
    setExplanationZh("");
    setExplanationEn("");
    setExplanationJa("");
    setAudio("");
    setTags("");
  };

  return (
    <form
      className="card-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!deckId) return;
        if (!isJapaneseNoteType && selectedNoteType) {
          const primaryField = selectedNoteType.fields[0]?.name;
          if (primaryField && !customFields[primaryField]?.trim()) return;
          await onCreate({
            noteTypeId: selectedNoteType.id,
            fields: Object.fromEntries(Object.entries(customFields).map(([key, value]) => [key, value.trim()])),
            tags: normalizeManualTagInput(tags),
            createAllTemplates: true
          });
          setCustomFields(Object.fromEntries(selectedNoteType.fields.map((field) => [field.name, ""])));
          setTags("");
          return;
        }
        if (!expression.trim()) return;
        const payload = buildManualJapaneseCardPayload({
          focus,
          expression,
          reading,
          pitchAccent,
          meaningZh,
          meaningEn,
          meaningJa,
          example,
          explanationZh,
          explanationEn,
          explanationJa,
          audio,
          tags
        });
        await onCreate(payload);
        resetJapaneseFields();
      }}
    >
      <select value={noteTypeId} onChange={(event) => setNoteTypeId(event.target.value)}>
        {noteTypes.map((noteType) => (
          <option key={noteType.id} value={noteType.id}>
            {noteType.name}
          </option>
        ))}
      </select>
      {isJapaneseNoteType ? (
        <>
          <select value={focus} onChange={(event) => setFocus(event.target.value as ManualCardFocus)}>
            <option value="vocabulary">Vocabulary</option>
            <option value="grammar">Grammar</option>
            <option value="pronunciation">Pronunciation</option>
          </select>
          <input value={expression} onChange={(event) => setExpression(event.target.value)} placeholder="Expression" />
          <input value={reading} onChange={(event) => setReading(event.target.value)} placeholder="Reading" />
          <input value={pitchAccent} onChange={(event) => setPitchAccent(event.target.value)} placeholder="Pitch accent" />
          <input value={meaningZh} onChange={(event) => setMeaningZh(event.target.value)} placeholder="中文释义" />
          <input value={meaningEn} onChange={(event) => setMeaningEn(event.target.value)} placeholder="English meaning" />
          <input value={meaningJa} onChange={(event) => setMeaningJa(event.target.value)} placeholder="日本語説明" />
          <input value={example} onChange={(event) => setExample(event.target.value)} placeholder="Example sentence" />
          <input value={explanationZh} onChange={(event) => setExplanationZh(event.target.value)} placeholder="中文补充说明" />
          <input value={explanationEn} onChange={(event) => setExplanationEn(event.target.value)} placeholder="English explanation" />
          <input value={explanationJa} onChange={(event) => setExplanationJa(event.target.value)} placeholder="日本語補足" />
          <input value={audio} onChange={(event) => setAudio(event.target.value)} placeholder="Audio [sound:...]" />
        </>
      ) : (
        selectedNoteType?.fields.map((field) => (
          <input
            key={field.id}
            value={customFields[field.name] ?? ""}
            onChange={(event) => setCustomFields((current) => ({ ...current, [field.name]: event.target.value }))}
            placeholder={field.name}
          />
        ))
      )}
      <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="tags: N4, 文法" />
      <button disabled={!deckId || !selectedNoteType}>Add</button>
    </form>
  );
}

function normalizeManualTagInput(tags: string) {
  return Array.from(new Set(tags.split(",").map((tag) => tag.trim()).filter(Boolean)));
}

function CardTable({
  cards,
  decks,
  page,
  onPage,
  onUpdate,
  onAudio,
  onSuspendToggle,
  onReset,
  onDelete,
  onDeleteNote
}: {
  cards: ReviewCard[];
  decks: Deck[];
  page: Pick<CardListPayload, "total" | "limit" | "offset" | "hasMore">;
  onPage: (offset: number) => void;
  onUpdate: (card: ReviewCard, fields: Record<string, string>, tags: string[], deckId: string) => Promise<void>;
  onAudio: (card: ReviewCard) => Promise<void>;
  onSuspendToggle: (card: ReviewCard) => Promise<void>;
  onReset: (card: ReviewCard) => Promise<void>;
  onDelete: (card: ReviewCard) => Promise<void>;
  onDeleteNote: (card: ReviewCard) => Promise<void>;
}) {
  return (
    <>
      <CardPagination page={page} onPage={onPage} />
      <div className="card-table">
        {cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            decks={decks}
            onUpdate={onUpdate}
            onAudio={onAudio}
            onSuspendToggle={onSuspendToggle}
            onReset={onReset}
            onDelete={onDelete}
            onDeleteNote={onDeleteNote}
          />
        ))}
      </div>
      <CardPagination page={page} onPage={onPage} />
    </>
  );
}

function CardPagination({
  page,
  onPage
}: {
  page: Pick<CardListPayload, "total" | "limit" | "offset" | "hasMore">;
  onPage: (offset: number) => void;
}) {
  if (page.total <= page.limit) return null;
  const start = page.total === 0 ? 0 : page.offset + 1;
  const end = Math.min(page.offset + page.limit, page.total);
  return (
    <div className="card-pagination">
      <span>
        {start}-{end} / {page.total}
      </span>
      <div className="row-actions">
        <button title="Previous page" disabled={page.offset === 0} onClick={() => onPage(Math.max(0, page.offset - page.limit))}>
          <ChevronLeft />
        </button>
        <button title="Next page" disabled={!page.hasMore} onClick={() => onPage(page.offset + page.limit)}>
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}

function CardRow({
  card,
  decks,
  onUpdate,
  onAudio,
  onSuspendToggle,
  onReset,
  onDelete,
  onDeleteNote
}: {
  card: ReviewCard;
  decks: Deck[];
  onUpdate: (card: ReviewCard, fields: Record<string, string>, tags: string[], deckId: string) => Promise<void>;
  onAudio: (card: ReviewCard) => Promise<void>;
  onSuspendToggle: (card: ReviewCard) => Promise<void>;
  onReset: (card: ReviewCard) => Promise<void>;
  onDelete: (card: ReviewCard) => Promise<void>;
  onDeleteNote: (card: ReviewCard) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [fieldState, setFieldState] = useState<Record<string, string>>(() => editableFieldsForCard(card));
  const [tagText, setTagText] = useState(card.tags.join(", "));
  const [targetDeckId, setTargetDeckId] = useState(card.deckId);

  useEffect(() => {
    setFieldState(editableFieldsForCard(card));
    setTagText(card.tags.join(", "));
    setTargetDeckId(card.deckId);
  }, [card]);

  const fieldNames = editableFieldNames(card);

  if (editing) {
    return (
      <form
        className="card-editor"
        onSubmit={async (event) => {
          event.preventDefault();
          const payload = {
            fields: Object.fromEntries(fieldNames.map((name) => [name, (fieldState[name] ?? "").trim()])),
            tags: parseTagText(tagText)
          };
          await onUpdate(card, payload.fields, payload.tags, targetDeckId);
          setEditing(false);
        }}
      >
        <p className="wide-field muted-text">{card.noteType.name} · {card.template.name}</p>
        <label className="wide-field">
          <span>Deck</span>
          <select value={targetDeckId} onChange={(event) => setTargetDeckId(event.target.value)}>
            {deckTreeOptions(decks).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {fieldNames.map((fieldName) => (
          <label key={fieldName} className={clsx(shouldUseTextarea(fieldName, fieldState[fieldName]) && "wide-field")}>
            <span>{fieldName}</span>
            {shouldUseTextarea(fieldName, fieldState[fieldName]) ? (
              <textarea value={fieldState[fieldName] ?? ""} onChange={(event) => setFieldState((current) => ({ ...current, [fieldName]: event.target.value }))} />
            ) : (
              <input value={fieldState[fieldName] ?? ""} onChange={(event) => setFieldState((current) => ({ ...current, [fieldName]: event.target.value }))} />
            )}
          </label>
        ))}
        <label className="wide-field">
          <span>Tags</span>
          <input
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            placeholder="vocabulary, N5"
          />
        </label>
        <div className="row-actions wide-field">
          <button title="Save card" type="submit">
            <Save />
          </button>
          <button title="Cancel" type="button" onClick={() => setEditing(false)}>
            <X />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={clsx("card-row", card.state === "suspended" && "suspended")}>
      <strong>{cardTitle(card)}</strong>
      <span>{cardSubtitle(card)}</span>
      <span>{cardDetail(card)}</span>
      <small>{card.noteType.name} · {card.template.name}</small>
      <small>{card.state}</small>
      <div className="row-actions">
        <button title="Generate audio" onClick={() => onAudio(card)}>
          <Volume2 />
        </button>
        <button title="Edit card" onClick={() => setEditing(true)}>
          <Pencil />
        </button>
        <button title={card.state === "suspended" ? "Restore card" : "Suspend card"} onClick={() => onSuspendToggle(card)}>
          {card.state === "suspended" ? <RotateCcw /> : <PauseCircle />}
        </button>
        <button title="Reset review progress" onClick={() => onReset(card)}>
          <RotateCcw />
        </button>
        <button title="Delete card" className="danger-button" onClick={() => onDelete(card)}>
          <Trash2 />
        </button>
        <button title="Delete note" className="danger-button" onClick={() => onDeleteNote(card)}>
          <X />
        </button>
      </div>
    </div>
  );
}

function CardHtml({ card, side }: { card: ReviewCard; side: "question" | "answer" }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const html = side === "answer" ? card.answer : card.question;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = [
      ":host { display: block; font-size: var(--card-html-font-size, 24px); line-height: 1.6; text-align: center; color: inherit; }",
      ".card { font-family: inherit; }",
      ".jp { font-size: var(--card-html-jp-font-size, 42px); }",
      "img, video { max-width: 100%; height: auto; }",
      "audio { max-width: 100%; }",
      sanitizeNoteTypeCss(card.noteType.css)
    ].join("\n");
    const body = document.createElement("div");
    body.className = "card";
    body.innerHTML = html;
    root.replaceChildren(style, body);
  }, [card.id, card.noteType.css, html]);

  return <div className="card-html" ref={hostRef} />;
}

function editableFieldNames(card: ReviewCard) {
  const names = card.fieldNames.length ? card.fieldNames : Object.keys(card.fields);
  return names.length ? names : ["Front", "Back"];
}

function editableFieldsForCard(card: ReviewCard) {
  return Object.fromEntries(editableFieldNames(card).map((name) => [name, card.fields[name] ?? ""]));
}

function cardTitle(card: ReviewCard) {
  return card.fields.Expression || firstFieldValue(card) || "(empty card)";
}

function cardSubtitle(card: ReviewCard) {
  return card.fields.Reading || nthFieldValue(card, 1);
}

function cardDetail(card: ReviewCard) {
  return card.fields.MeaningZh || card.fields.MeaningEn || nthFieldValue(card, 2);
}

function firstFieldValue(card: ReviewCard) {
  return nthFieldValue(card, 0);
}

function nthFieldValue(card: ReviewCard, index: number) {
  const name = editableFieldNames(card)[index];
  return name ? card.fields[name] ?? "" : "";
}

function shouldUseTextarea(fieldName: string, value = "") {
  return value.length > 80 || /back|example|explanation|extra|memo|note|source|text/i.test(fieldName);
}

function parseTagText(tags: string) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags.split(",").map((value) => value.trim()).filter(Boolean)) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized;
}

function UrlPanel({
  title,
  placeholder,
  action,
  busy,
  onSubmit
}: {
  title: string;
  placeholder: string;
  action: string;
  busy: boolean;
  onSubmit: (url: string) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  return (
    <form
      className="panel url-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!url.trim()) return;
        await onSubmit(url);
      }}
    >
      <h2>{title}</h2>
      <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={placeholder} />
      <button disabled={busy}>{busy ? <Loader2 className="spin" /> : <FileDown />} {action}</button>
    </form>
  );
}

function PackageImportPanel({
  title,
  placeholder,
  action,
  busy,
  defaultOptions,
  onSubmit,
  onFileSubmit
}: {
  title: string;
  placeholder: string;
  action: string;
  busy: boolean;
  defaultOptions: ImportPackageOptions;
  onSubmit: (url: string, options: ImportPackageOptions) => Promise<void>;
  onFileSubmit: (file: File, options: ImportPackageOptions) => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [includeScheduling, setIncludeScheduling] = useState(defaultOptions.includeScheduling);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    setIncludeScheduling(defaultOptions.includeScheduling);
  }, [defaultOptions.includeScheduling]);

  return (
    <form
      className="panel url-panel"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!url.trim()) return;
        await onSubmit(url, { includeScheduling });
      }}
    >
      <h2>{title}</h2>
      <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={placeholder} />
      <label className="option-row">
        <input type="checkbox" checked={includeScheduling} onChange={(event) => setIncludeScheduling(event.target.checked)} />
        Include review progress
      </label>
      <button disabled={busy}>{busy ? <Loader2 className="spin" /> : <FileDown />} {action}</button>
      <label className="file-upload-row">
        <span>Upload .apkg/.colpkg file</span>
        <input
          type="file"
          accept=".apkg,.colpkg,application/vnd.anki.package,application/octet-stream"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      <button
        type="button"
        disabled={busy || !file}
        onClick={async () => {
          if (!file) return;
          await onFileSubmit(file, { includeScheduling });
          setFile(null);
        }}
      >
        {busy ? <Loader2 className="spin" /> : <UploadCloud />} Import uploaded package
      </button>
    </form>
  );
}

function EmptyState({ title, action, onClick }: { title: string; action: string; onClick: () => void }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      <button onClick={onClick}>{action}</button>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function StatsBreakdown({ title, rows }: { title: string; rows: StatsMetricRow[] }) {
  return (
    <section className="stats-panel">
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      <div className="metric-list">
        {rows.map((row) => (
          <div key={row.key} className="metric-row">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ActivitySummary({ bars }: { bars: ActivityBar[] }) {
  return (
    <section className="stats-panel activity-panel">
      <div className="section-heading">
        <h2>7-day activity</h2>
      </div>
      <div className="activity-bars" aria-label="Review activity over the last 7 days">
        {bars.map((bar) => (
          <div key={bar.date} className="activity-day">
            <div className="activity-track" title={`${bar.reviews} reviews on ${bar.date}`}>
              <div className="activity-fill" style={{ height: `${bar.percent}%` }} />
            </div>
            <span>{bar.label}</span>
            <strong>{bar.reviews}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReviewCalendar({ cells }: { cells: CalendarCell[] }) {
  return (
    <section className="stats-panel calendar-panel">
      <div className="section-heading">
        <h2>Monthly calendar</h2>
      </div>
      <div className="calendar-grid" aria-label="Current month review calendar">
        {cells.map((cell) => (
          <div key={cell.date} className={clsx("calendar-cell", `level-${cell.level}`)} title={`${cell.reviews} reviews on ${cell.date}`}>
            <span>{cell.label}</span>
            <strong>{cell.reviews}</strong>
            <small>{cell.elapsedMinutes}m</small>
          </div>
        ))}
      </div>
    </section>
  );
}
