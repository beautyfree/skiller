import {
  applyGitClonePlan,
  planGitCheckout,
  type GitClonePlan,
} from "dotagents/git-workspace";
import {
  applyGitFastForwardPlan,
  planGitFastForward,
  type GitFastForwardPlan,
} from "dotagents/git-fast-forward";
import type { SourceSecurityPolicyInput } from "dotagents/source-policy";

/**
 * Materialize only the exact commit resolved by a reviewed dotagents plan.
 * No Skiller caller should use a moving `git clone` for remote content.
 */
export async function checkoutReviewedGitSource(
  remote: string,
  target: string,
  requestedRef: string | null | undefined,
  sourcePolicy: SourceSecurityPolicyInput,
): Promise<GitClonePlan> {
  const plan = await planGitCheckout(
    remote,
    target,
    requestedRef?.trim() || "HEAD",
    sourcePolicy,
  );
  await applyGitClonePlan(plan);
  return plan;
}

/** Apply only the exact clean fast-forward described by a reviewed plan. */
export async function fastForwardReviewedGitSource(
  workspace: string,
  sourcePolicy: SourceSecurityPolicyInput,
): Promise<GitFastForwardPlan> {
  const plan = await planGitFastForward(workspace, sourcePolicy);
  await applyGitFastForwardPlan(plan);
  return plan;
}
