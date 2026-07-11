import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
	MonitorCheck,
	Package,
	Check,
	Loader2,
	Download,
	ExternalLink,
	FolderKanban,
	Wand2,
} from "lucide-react";
import { invoke, openUrl } from "@/mainview/lib/native";
import { Button } from "@/mainview/components/ui/button";
import { AgentIcon } from "@/mainview/components/AgentIcon";
import { useAgents } from "@/mainview/hooks/useAgents";
import { extractMarkdownBody } from "@/mainview/lib/markdown";
import type { MarketplaceSkillJson } from "@/shared/rpc-schema";
import skillerMark from "@/mainview/assets/brand/skiller-mark.png";

type Step = "welcome" | "agents" | "marketplace" | "done";

/**
 * First-run onboarding is informational, not transactional. We don't install
 * skills here — a user who just opened the app has no way to evaluate which
 * skill is worth installing. Instead we: confirm detected agents, show what
 * the Marketplace looks like, and offer optional sync. Actual installs happen
 * later from the Marketplace when the user has context.
 */
export default function OnboardingWizard({
	onClose,
}: {
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { data: agents } = useAgents();
	const detectedAgents = useMemo(
		() => agents?.filter((a) => a.detected) ?? [],
		[agents],
	);

	const [step, setStep] = useState<Step>("welcome");
	const [autoDownloadUpdates, setAutoDownloadUpdates] = useState(true);
	const [popular, setPopular] = useState<MarketplaceSkillJson[] | null>(null);
	const [loadingPopular, setLoadingPopular] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	/** Fetched remote descriptions, keyed by skillKey(). null = fetched but missing. */
	const [remoteDescriptions, setRemoteDescriptions] = useState<
		Record<string, string | null>
	>({});
	/**
	 * Teaser load — fetches top 4 skills from skills.sh plus their SKILL.md
	 * descriptions, purely so the user sees what's in the marketplace. No
	 * install UI here: the point is discovery, not commitment.
	 */
	useEffect(() => {
		if (step !== "marketplace" || popular !== null || loadingPopular) return;
		setLoadingPopular(true);
		setLoadError(null);
		invoke("fetch_skillssh", { sort: "all-time", page: 1 })
			.then(async (items) => {
				const top = (items as MarketplaceSkillJson[]).slice(0, 4);
				setPopular(top);

				const descPairs = await Promise.all(
					top.map(async (s) => {
						const key = skillKey(s);
						if (!s.repository) return [key, null] as const;
						try {
							const md = (await invoke("fetch_remote_skill_content", {
								repoUrl: s.repository,
								skillName: s.name,
							})) as string;
							const frontmatter = parseFrontmatter(md);
							if (frontmatter.description)
								return [key, frontmatter.description] as const;
							const body = extractMarkdownBody(md).trim();
							const firstPara = body.split(/\n\s*\n/)[0]?.trim() ?? "";
							return [key, firstPara || null] as const;
						} catch {
							return [key, null] as const;
						}
					}),
				);
				const map: Record<string, string | null> = {};
				for (const [k, d] of descPairs) map[k] = d;
				setRemoteDescriptions(map);
			})
			.catch((err) => {
				setLoadError(err instanceof Error ? err.message : String(err));
				setPopular([]);
			})
			.finally(() => setLoadingPopular(false));
	}, [step, popular, loadingPopular]);

	function markDoneAndClose() {
		try {
			localStorage.setItem("skiller.onboarding.done", "1");
		} catch {
			/* ignore */
		}
		void invoke("read_settings")
			.then((settings) =>
				invoke("write_settings", {
					settings: {
						...settings,
						auto_download_updates: autoDownloadUpdates,
					},
				}),
			)
			.catch(() => {});
		onClose();
	}

	function skillKey(s: MarketplaceSkillJson): string {
		return `${s.source}|${s.repository ?? ""}|${s.name}`;
	}

	function goToMarketplace() {
		markDoneAndClose();
		navigate("/marketplace");
	}

	function goToProjects() {
		markDoneAndClose();
		navigate("/projects");
	}

	function goToSkills() {
		markDoneAndClose();
		navigate("/skills");
	}

	return (
		<div
			className="modal-shell fixed inset-0 z-50 flex items-center justify-center bg-black/25 dark:bg-black/40 animate-backdrop-in"
			onClick={markDoneAndClose}
		>
			<div
				role="dialog"
				aria-modal="true"
				className="modal-panel w-full max-w-xl rounded-3xl p-6 outline-none animate-modal-in glass-elevated"
				onClick={(e) => e.stopPropagation()}
			>
				<StepDots current={step} />

				{step === "welcome" && (
					<div className="space-y-4">
						<div className="flex flex-col items-center gap-2 pt-2 pb-1 text-center">
							<img
								src={skillerMark}
								alt="Skiller"
								className="size-20 select-none drop-shadow-sm"
								draggable={false}
							/>
							<p className="text-3xl font-[590] tracking-tight">
								Skiller
							</p>
							<h2 className="mt-1 text-xl font-[590] tracking-tight">
								{t("onboarding.welcomeTitlePre")}{" "}
								<span className="text-primary">
									{t("onboarding.welcomeTitleHighlight")}
								</span>{" "}
								{t("onboarding.welcomeTitlePost")}{" "}
								<span className="font-mono text-primary">SKILL.md</span>
							</h2>
						</div>
						<p className="text-sm text-muted-foreground leading-relaxed text-center">
							{t("onboarding.welcomeBodyPre")}{" "}
							<strong className="text-foreground font-[550]">
								{t("onboarding.welcomeBodyHighlight")}
							</strong>{" "}
							{t("onboarding.welcomeBodyPost")}
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="outline" size="sm" onClick={markDoneAndClose}>
								{t("onboarding.skip")}
							</Button>
							<Button size="sm" onClick={() => setStep("agents")}>
								{t("onboarding.next")}
							</Button>
						</div>
					</div>
				)}

				{step === "agents" && (
					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<MonitorCheck className="size-5 text-primary" />
							<h2 className="text-lg font-[590]">
								{t("onboarding.agentsTitle")}
							</h2>
						</div>
						<p className="text-sm text-muted-foreground leading-relaxed">
							{detectedAgents.length > 0 ? (
								<>
									We found{" "}
									<strong className="text-foreground font-[550]">
										{detectedAgents.length}{" "}
										{detectedAgents.length === 1 ? "agent" : "agents"}
									</strong>{" "}
									on this machine. Skills you install will be{" "}
									<span className="text-primary font-[550]">
										wired up to all of them
									</span>{" "}
									automatically.
								</>
							) : (
								t("onboarding.agentsBodyEmpty")
							)}
						</p>

						{detectedAgents.length > 0 ? (
							<div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
								{detectedAgents.map((a) => (
									<div
										key={a.slug}
										className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/5 px-3 py-2"
									>
										<AgentIcon slug={a.slug} className="size-5 shrink-0" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">{a.name}</p>
											{a.cli_command && (
												<p className="truncate text-[10px] font-mono text-muted-foreground">
													{a.cli_command}
												</p>
											)}
										</div>
										<Check className="size-3.5 shrink-0 text-emerald-500" />
									</div>
								))}
							</div>
						) : (
							<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-xs text-amber-800 dark:text-amber-300">
								{t("onboarding.agentsEmptyHint")}
							</div>
						)}

						<div className="flex justify-between gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setStep("welcome")}
							>
								{t("onboarding.back")}
							</Button>
							<Button size="sm" onClick={() => setStep("marketplace")}>
								{t("onboarding.next")}
							</Button>
						</div>
					</div>
				)}

				{step === "marketplace" && (
					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<Package className="size-5 text-primary" />
							<h2 className="text-lg font-[590]">
								A peek at the{" "}
								<span className="text-primary">Marketplace</span>
							</h2>
						</div>
						<p className="text-sm text-muted-foreground leading-relaxed">
							Here's what's popular on{" "}
							<span className="text-primary font-[550]">skills.sh</span>{" "}
							right now. Don't install anything yet — come back when you
							know what you actually need.
						</p>

						<div className="space-y-1.5 max-h-72 overflow-y-auto">
							{loadingPopular && (
								<div className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-3 text-xs text-muted-foreground">
									<Loader2 className="size-3.5 animate-spin" />
									{t("onboarding.skillsLoading")}
								</div>
							)}

							{!loadingPopular && loadError && (
								<div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs">
									<p className="text-destructive">
										{t("onboarding.skillsLoadFailed", { error: loadError })}
									</p>
								</div>
							)}

							{!loadingPopular &&
								popular &&
								popular.map((s) => {
									const key = skillKey(s);
									const descLoaded = key in remoteDescriptions;
									const desc = s.description || remoteDescriptions[key] || null;
									return (
										<div
											key={key}
											className="rounded-lg border border-border/40 px-3 py-2"
										>
											<div className="flex items-center gap-2">
												<p className="flex-1 truncate text-sm font-medium">
													{s.name}
												</p>
												{s.installs != null && (
													<span className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground tabular-nums">
														<Download className="size-2.5" />
														{formatInstalls(s.installs)}
													</span>
												)}
											</div>
											{desc ? (
												<p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
													{desc}
												</p>
											) : descLoaded ? (
												<p className="text-xs italic text-muted-foreground/70">
													{t("onboarding.noDescription")}
												</p>
											) : (
												<p className="text-xs text-muted-foreground/50">
													<Loader2 className="inline size-3 animate-spin mr-1" />
													{t("onboarding.loadingDescription")}
												</p>
											)}
											<div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
												{s.author && <span>{s.author}</span>}
												{s.author && <span>·</span>}
												<button
													type="button"
													className="inline-flex items-center gap-0.5 hover:underline"
													onClick={(e) => {
														e.preventDefault();
														if (s.repository) openUrl(s.repository);
													}}
												>
													{s.source}
													<ExternalLink className="size-2.5" />
												</button>
											</div>
										</div>
									);
								})}
						</div>

						<div className="flex justify-between gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setStep("agents")}
							>
								{t("onboarding.back")}
							</Button>
							<Button size="sm" onClick={() => setStep("done")}>
								{t("onboarding.next")}
							</Button>
						</div>
					</div>
				)}

				{step === "done" && (
					<div className="space-y-4">
						<div className="flex items-center gap-2">
							<Check className="size-5 text-emerald-500" />
							<h2 className="text-lg font-[590]">
								You're{" "}
								<span className="text-emerald-500">ready</span>
							</h2>
						</div>
						<p className="text-sm text-muted-foreground leading-relaxed">
							Pick whatever fits what brought you here:
						</p>

						<div className="grid grid-cols-3 gap-2">
							<button
								type="button"
								onClick={goToSkills}
								className="flex flex-col items-start gap-1 rounded-lg border border-border/40 bg-muted/5 px-3 py-2.5 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
							>
								<Wand2 className="size-4 text-primary" />
								<p className="text-sm font-medium">
									{t("onboarding.ctaSkillsTitle")}
								</p>
								<p className="text-[11px] text-muted-foreground leading-snug">
									{t("onboarding.ctaSkillsBody")}
								</p>
							</button>
							<button
								type="button"
								onClick={goToMarketplace}
								className="flex flex-col items-start gap-1 rounded-lg border border-border/40 bg-muted/5 px-3 py-2.5 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
							>
								<Package className="size-4 text-primary" />
								<p className="text-sm font-medium">
									{t("onboarding.ctaMarketplaceTitle")}
								</p>
								<p className="text-[11px] text-muted-foreground leading-snug">
									{t("onboarding.ctaMarketplaceBody")}
								</p>
							</button>
							<button
								type="button"
								onClick={goToProjects}
								className="flex flex-col items-start gap-1 rounded-lg border border-border/40 bg-muted/5 px-3 py-2.5 text-left transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
							>
								<FolderKanban className="size-4 text-primary" />
								<p className="text-sm font-medium">
									{t("onboarding.ctaProjectsTitle")}
								</p>
								<p className="text-[11px] text-muted-foreground leading-snug">
									{t("onboarding.ctaProjectsBody")}
								</p>
							</button>
						</div>

						<label className="mx-auto flex max-w-md cursor-pointer select-none items-start gap-2.5 rounded-lg border border-border/40 bg-muted/5 px-3 py-2.5 transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
							<input
								type="checkbox"
								checked={autoDownloadUpdates}
								onChange={(e) => setAutoDownloadUpdates(e.target.checked)}
								className="mt-0.5 size-3.5 rounded accent-primary"
							/>
							<span className="min-w-0">
								<span className="block text-xs font-medium text-foreground">
									{t("onboarding.autoDownloadUpdatesTitle")}
								</span>
								<span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
									{t("onboarding.autoDownloadUpdatesBody")}
								</span>
							</span>
						</label>

						<div className="flex justify-end">
							<Button variant="outline" size="sm" onClick={markDoneAndClose}>
								{t("onboarding.finish")}
							</Button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

function formatInstalls(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return String(n);
}

/** Minimal YAML frontmatter parser — just pulls the `description` field. */
function parseFrontmatter(md: string): { description?: string } {
	const normalized = md.replace(/\r\n/g, "\n").trimStart();
	if (!normalized.startsWith("---")) return {};
	const end = normalized.indexOf("\n---", 3);
	if (end < 0) return {};
	const front = normalized.slice(3, end).trim();
	const single = front.match(/^description:\s*(.+?)$/m);
	if (single) {
		let v = single[1].trim();
		if (
			(v.startsWith('"') && v.endsWith('"')) ||
			(v.startsWith("'") && v.endsWith("'"))
		) {
			v = v.slice(1, -1);
		}
		return { description: v };
	}
	return {};
}

function StepDots({ current }: { current: Step }) {
	const order: Step[] = ["welcome", "agents", "marketplace", "done"];
	const idx = order.indexOf(current);
	return (
		<div className="mb-4 flex items-center gap-1.5">
			{order.map((_, i) => (
				<div
					key={i}
					className={`h-1 rounded-full transition-all ${
						i === idx
							? "w-6 bg-primary"
							: i < idx
								? "w-3 bg-primary/40"
								: "w-3 bg-muted-foreground/20"
					}`}
				/>
			))}
		</div>
	);
}
