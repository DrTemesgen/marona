// zod schemas for every server input: bodies, query strings, path params and headers.
// Bodies are strict: unknown fields are refused, so nothing extra (a name, a phone number) can
// ride along with a request.
import { z } from 'zod';
import { Mode } from '../src/shared/contract';

export const MAX_ACTIONS = 3000; // the same cap as MAX_LOG_ACTIONS in plausibility.ts

const Id = z.string().min(1).max(80).regex(/^[A-Za-z0-9_.:-]+$/);
const Code = z.string().min(3).max(32).regex(/^[A-Za-z0-9-]+$/);
const IntString = z
  .string()
  .regex(/^[1-9][0-9]{0,11}$/)
  .transform(Number);

export const PlayerActionIn = z
  .object({
    actionId: Id,
    t: z.number().nonnegative(),
    payload: z
      .object({
        bpm: z.number().nonnegative().optional(),
        count: z.number().int().nonnegative().max(10_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const JoinBody = z.object({ classCode: Code, nickname: z.string().max(40) }).strict();

export const RunBody = z
  .object({
    caseId: Id,
    mode: Mode,
    seed: z.number().int().min(0).max(0xffffffff),
    variantId: Id,
    actions: z.array(PlayerActionIn).max(MAX_ACTIONS),
    endT: z.number().nonnegative(),
    clientScore: z.number(),
  })
  .strict();

export const FinalStartBody = z.object({ finalId: z.number().int().positive(), caseId: Id }).strict();

export const FinalSubmitBody = z
  .object({
    finalId: z.number().int().positive(),
    caseId: Id,
    actions: z.array(PlayerActionIn).max(MAX_ACTIONS),
    endT: z.number().nonnegative(),
  })
  .strict();

export const BoardsQuery = z.object({ scope: z.enum(['class', 'school']) });
export const ResultsQuery = z.object({ finalId: IntString });
export const PlayerIdParam = IntString;
export const PlayerToken = z.string().regex(/^[A-Za-z0-9_-]{20,128}$/);
export const TeacherCode = Code;
export const CaseIdList = z.array(Id).min(1);
