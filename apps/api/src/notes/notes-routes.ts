import { CreateNoteInput } from '@atlas/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/auth-context.js';
import { requestIdOf } from '../http/request-id.js';
import { parseOrThrow } from '../http/validate.js';
import { toNoteDto } from './note-dto.js';
import type { Actor, NotesService } from './notes-service.js';

const NoteIdParams = z.object({ id: z.uuid() });

export function notesRouter(notes: NotesService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const list = await notes.list(actorOf(req));
    res.json(list.map(toNoteDto));
  });

  router.post('/', async (req, res) => {
    const input = parseOrThrow(CreateNoteInput, req.body);
    const note = await notes.create(actorOf(req), input);
    res.status(201).json(toNoteDto(note));
  });

  router.delete('/:id', async (req, res) => {
    const { id } = parseOrThrow(NoteIdParams, req.params);
    await notes.remove(actorOf(req), id);
    res.status(204).end();
  });

  return router;
}

function actorOf(req: Request): Actor {
  return { userId: authOf(req).userId, requestId: requestIdOf(req) };
}
