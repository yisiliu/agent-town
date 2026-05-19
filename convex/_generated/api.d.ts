/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as ours_actions_llmRouter from "../ours/actions/llmRouter.js";
import type * as ours_actions_piiScan from "../ours/actions/piiScan.js";
import type * as ours_actions_promptInjectionScan from "../ours/actions/promptInjectionScan.js";
import type * as ours_actions_runTwinScans from "../ours/actions/runTwinScans.js";
import type * as ours_actions_uploadTwin from "../ours/actions/uploadTwin.js";
import type * as ours_crons_sessionWindow from "../ours/crons/sessionWindow.js";
import type * as ours_lib_authCodeStore from "../ours/lib/authCodeStore.js";
import type * as ours_lib_cardValidator from "../ours/lib/cardValidator.js";
import type * as ours_lib_codes from "../ours/lib/codes.js";
import type * as ours_lib_deepseekClient from "../ours/lib/deepseekClient.js";
import type * as ours_lib_finalizeScanCore from "../ours/lib/finalizeScanCore.js";
import type * as ours_lib_idempotency from "../ours/lib/idempotency.js";
import type * as ours_lib_instructorAuth from "../ours/lib/instructorAuth.js";
import type * as ours_lib_llmRouterCore from "../ours/lib/llmRouterCore.js";
import type * as ours_lib_piiPatterns from "../ours/lib/piiPatterns.js";
import type * as ours_lib_piiScanCore from "../ours/lib/piiScanCore.js";
import type * as ours_lib_promptInjectionScanCore from "../ours/lib/promptInjectionScanCore.js";
import type * as ours_lib_rateLimit from "../ours/lib/rateLimit.js";
import type * as ours_lib_session from "../ours/lib/session.js";
import type * as ours_lib_sessionWindowCore from "../ours/lib/sessionWindowCore.js";
import type * as ours_lib_spendTracking from "../ours/lib/spendTracking.js";
import type * as ours_lib_togetherClient from "../ours/lib/togetherClient.js";
import type * as ours_lib_uploadFlowCore from "../ours/lib/uploadFlowCore.js";
import type * as ours_lib_uploadResultsStore from "../ours/lib/uploadResultsStore.js";
import type * as ours_lib_worldState from "../ours/lib/worldState.js";
import type * as ours_mutations_addAgentDailySpend from "../ours/mutations/addAgentDailySpend.js";
import type * as ours_mutations_applyScheduledStatus from "../ours/mutations/applyScheduledStatus.js";
import type * as ours_mutations_checkAndIncrementAttempts from "../ours/mutations/checkAndIncrementAttempts.js";
import type * as ours_mutations_clearUploadResult from "../ours/mutations/clearUploadResult.js";
import type * as ours_mutations_createPendingTwin from "../ours/mutations/createPendingTwin.js";
import type * as ours_mutations_createSession from "../ours/mutations/createSession.js";
import type * as ours_mutations_finalizeScan from "../ours/mutations/finalizeScan.js";
import type * as ours_mutations_freezeWorld from "../ours/mutations/freezeWorld.js";
import type * as ours_mutations_instructorAuthenticate from "../ours/mutations/instructorAuthenticate.js";
import type * as ours_mutations_instructorRegister from "../ours/mutations/instructorRegister.js";
import type * as ours_mutations_issueCode from "../ours/mutations/issueCode.js";
import type * as ours_mutations_recordLlmCall from "../ours/mutations/recordLlmCall.js";
import type * as ours_mutations_resumeWorld from "../ours/mutations/resumeWorld.js";
import type * as ours_queries_getAgentDailySpend from "../ours/queries/getAgentDailySpend.js";
import type * as ours_queries_getCachedLlmCall from "../ours/queries/getCachedLlmCall.js";
import type * as ours_queries_getCardForScan from "../ours/queries/getCardForScan.js";
import type * as ours_queries_getSession from "../ours/queries/getSession.js";
import type * as ours_queries_instructorSession from "../ours/queries/instructorSession.js";
import type * as ours_queries_uploadResultByToken from "../ours/queries/uploadResultByToken.js";
import type * as ours_queries_verifyCode from "../ours/queries/verifyCode.js";
import type * as ours_queries_worldStatus from "../ours/queries/worldStatus.js";
import type * as ours_tables_agentDailySpend from "../ours/tables/agentDailySpend.js";
import type * as ours_tables_auditLog from "../ours/tables/auditLog.js";
import type * as ours_tables_authCodes from "../ours/tables/authCodes.js";
import type * as ours_tables_cards from "../ours/tables/cards.js";
import type * as ours_tables_consents from "../ours/tables/consents.js";
import type * as ours_tables_crossBorderTransfers from "../ours/tables/crossBorderTransfers.js";
import type * as ours_tables_digests from "../ours/tables/digests.js";
import type * as ours_tables_gameTurns from "../ours/tables/gameTurns.js";
import type * as ours_tables_games from "../ours/tables/games.js";
import type * as ours_tables_index from "../ours/tables/index.js";
import type * as ours_tables_instructorAuthenticators from "../ours/tables/instructorAuthenticators.js";
import type * as ours_tables_instructorChallenges from "../ours/tables/instructorChallenges.js";
import type * as ours_tables_instructorSessions from "../ours/tables/instructorSessions.js";
import type * as ours_tables_instructors from "../ours/tables/instructors.js";
import type * as ours_tables_llmCallIdempotency from "../ours/tables/llmCallIdempotency.js";
import type * as ours_tables_noticeboard from "../ours/tables/noticeboard.js";
import type * as ours_tables_objects from "../ours/tables/objects.js";
import type * as ours_tables_rateLimits from "../ours/tables/rateLimits.js";
import type * as ours_tables_reflections from "../ours/tables/reflections.js";
import type * as ours_tables_retractions from "../ours/tables/retractions.js";
import type * as ours_tables_studentSessions from "../ours/tables/studentSessions.js";
import type * as ours_tables_twins from "../ours/tables/twins.js";
import type * as ours_tables_uploadResults from "../ours/tables/uploadResults.js";
import type * as ours_tables_worldState from "../ours/tables/worldState.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  "ours/actions/llmRouter": typeof ours_actions_llmRouter;
  "ours/actions/piiScan": typeof ours_actions_piiScan;
  "ours/actions/promptInjectionScan": typeof ours_actions_promptInjectionScan;
  "ours/actions/runTwinScans": typeof ours_actions_runTwinScans;
  "ours/actions/uploadTwin": typeof ours_actions_uploadTwin;
  "ours/crons/sessionWindow": typeof ours_crons_sessionWindow;
  "ours/lib/authCodeStore": typeof ours_lib_authCodeStore;
  "ours/lib/cardValidator": typeof ours_lib_cardValidator;
  "ours/lib/codes": typeof ours_lib_codes;
  "ours/lib/deepseekClient": typeof ours_lib_deepseekClient;
  "ours/lib/finalizeScanCore": typeof ours_lib_finalizeScanCore;
  "ours/lib/idempotency": typeof ours_lib_idempotency;
  "ours/lib/instructorAuth": typeof ours_lib_instructorAuth;
  "ours/lib/llmRouterCore": typeof ours_lib_llmRouterCore;
  "ours/lib/piiPatterns": typeof ours_lib_piiPatterns;
  "ours/lib/piiScanCore": typeof ours_lib_piiScanCore;
  "ours/lib/promptInjectionScanCore": typeof ours_lib_promptInjectionScanCore;
  "ours/lib/rateLimit": typeof ours_lib_rateLimit;
  "ours/lib/session": typeof ours_lib_session;
  "ours/lib/sessionWindowCore": typeof ours_lib_sessionWindowCore;
  "ours/lib/spendTracking": typeof ours_lib_spendTracking;
  "ours/lib/togetherClient": typeof ours_lib_togetherClient;
  "ours/lib/uploadFlowCore": typeof ours_lib_uploadFlowCore;
  "ours/lib/uploadResultsStore": typeof ours_lib_uploadResultsStore;
  "ours/lib/worldState": typeof ours_lib_worldState;
  "ours/mutations/addAgentDailySpend": typeof ours_mutations_addAgentDailySpend;
  "ours/mutations/applyScheduledStatus": typeof ours_mutations_applyScheduledStatus;
  "ours/mutations/checkAndIncrementAttempts": typeof ours_mutations_checkAndIncrementAttempts;
  "ours/mutations/clearUploadResult": typeof ours_mutations_clearUploadResult;
  "ours/mutations/createPendingTwin": typeof ours_mutations_createPendingTwin;
  "ours/mutations/createSession": typeof ours_mutations_createSession;
  "ours/mutations/finalizeScan": typeof ours_mutations_finalizeScan;
  "ours/mutations/freezeWorld": typeof ours_mutations_freezeWorld;
  "ours/mutations/instructorAuthenticate": typeof ours_mutations_instructorAuthenticate;
  "ours/mutations/instructorRegister": typeof ours_mutations_instructorRegister;
  "ours/mutations/issueCode": typeof ours_mutations_issueCode;
  "ours/mutations/recordLlmCall": typeof ours_mutations_recordLlmCall;
  "ours/mutations/resumeWorld": typeof ours_mutations_resumeWorld;
  "ours/queries/getAgentDailySpend": typeof ours_queries_getAgentDailySpend;
  "ours/queries/getCachedLlmCall": typeof ours_queries_getCachedLlmCall;
  "ours/queries/getCardForScan": typeof ours_queries_getCardForScan;
  "ours/queries/getSession": typeof ours_queries_getSession;
  "ours/queries/instructorSession": typeof ours_queries_instructorSession;
  "ours/queries/uploadResultByToken": typeof ours_queries_uploadResultByToken;
  "ours/queries/verifyCode": typeof ours_queries_verifyCode;
  "ours/queries/worldStatus": typeof ours_queries_worldStatus;
  "ours/tables/agentDailySpend": typeof ours_tables_agentDailySpend;
  "ours/tables/auditLog": typeof ours_tables_auditLog;
  "ours/tables/authCodes": typeof ours_tables_authCodes;
  "ours/tables/cards": typeof ours_tables_cards;
  "ours/tables/consents": typeof ours_tables_consents;
  "ours/tables/crossBorderTransfers": typeof ours_tables_crossBorderTransfers;
  "ours/tables/digests": typeof ours_tables_digests;
  "ours/tables/gameTurns": typeof ours_tables_gameTurns;
  "ours/tables/games": typeof ours_tables_games;
  "ours/tables/index": typeof ours_tables_index;
  "ours/tables/instructorAuthenticators": typeof ours_tables_instructorAuthenticators;
  "ours/tables/instructorChallenges": typeof ours_tables_instructorChallenges;
  "ours/tables/instructorSessions": typeof ours_tables_instructorSessions;
  "ours/tables/instructors": typeof ours_tables_instructors;
  "ours/tables/llmCallIdempotency": typeof ours_tables_llmCallIdempotency;
  "ours/tables/noticeboard": typeof ours_tables_noticeboard;
  "ours/tables/objects": typeof ours_tables_objects;
  "ours/tables/rateLimits": typeof ours_tables_rateLimits;
  "ours/tables/reflections": typeof ours_tables_reflections;
  "ours/tables/retractions": typeof ours_tables_retractions;
  "ours/tables/studentSessions": typeof ours_tables_studentSessions;
  "ours/tables/twins": typeof ours_tables_twins;
  "ours/tables/uploadResults": typeof ours_tables_uploadResults;
  "ours/tables/worldState": typeof ours_tables_worldState;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
