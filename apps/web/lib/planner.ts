import type {
  AddPlanBlockInput,
  CloseDayPlanInput,
  CompletePlanBlockInput,
  CreateDayPlanInput,
  DayPlanDetail,
  DropPlanBlockInput,
  PlanCandidatesResponse,
  PlannerSettings,
  PlannerTodayResponse,
  UpdatePlanBlockInput,
  UpdatePlannerSettingsInput,
} from '@jobradar/shared';

import { apiFetch } from './api';

/** Day planner (ADR-015) — increment 1: settings, candidates, manual plan. */

export function getToday(): Promise<PlannerTodayResponse> {
  return apiFetch<PlannerTodayResponse>('/planner/today');
}

export function getCandidates(): Promise<PlanCandidatesResponse> {
  return apiFetch<PlanCandidatesResponse>('/planner/candidates');
}

export function createDayPlan(input: CreateDayPlanInput = {}): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>('/planner/plans', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function acceptDayPlan(planId: string): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/plans/${planId}/accept`, { method: 'POST' });
}

export function setPlanIntent(planId: string, intent: string): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify({ intent }),
  });
}

export function reorderBlocks(planId: string, blockIds: string[]): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/plans/${planId}/reorder`, {
    method: 'POST',
    body: JSON.stringify({ blockIds }),
  });
}

export function addBlock(input: AddPlanBlockInput): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>('/planner/blocks', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateBlock(
  blockId: string,
  input: UpdatePlanBlockInput,
): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/blocks/${blockId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function startBlock(blockId: string): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/blocks/${blockId}/start`, { method: 'POST' });
}

export function pauseBlock(blockId: string): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/blocks/${blockId}/pause`, { method: 'POST' });
}

export function completeBlock(
  blockId: string,
  input: CompletePlanBlockInput,
): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/blocks/${blockId}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function closeDayPlan(planId: string, input: CloseDayPlanInput = {}): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/plans/${planId}/close`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function dropBlock(blockId: string, input: DropPlanBlockInput = {}): Promise<DayPlanDetail> {
  return apiFetch<DayPlanDetail>(`/planner/blocks/${blockId}`, {
    method: 'DELETE',
    body: JSON.stringify(input),
  });
}

export function updatePlannerSettings(
  input: UpdatePlannerSettingsInput,
): Promise<PlannerSettings> {
  return apiFetch<PlannerSettings>('/planner/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
