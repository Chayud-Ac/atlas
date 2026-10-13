import { CreateNoteInput, type Note } from '@atlas/shared';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authOf } from '../auth/authenticate.js';
import { parseOrThrow } from '../errors.js';
import { requestIdOf } from '../logging.js';
import type { NoteRecord } from './notes.repository.js';
import type { Actor, NotesService } from './notes.service.js';

const NoteIdParams = z.object({ id: z.uuid() });

/** Mounted at /api/notes. */
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

/** The API's JSON shape for a note: no owner id, ISO 8601 timestamps. */
function toNoteDto(record: NoteRecord): Note {
  return {
    id: record.id,
    title: record.title,
    body: record.body,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
