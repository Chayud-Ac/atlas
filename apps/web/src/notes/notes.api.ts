import { type CreateNoteInput, Note } from '@atlas/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useApi } from '../api.js';

const NOTES_KEY = ['notes'];
const NoteList = z.array(Note);

export function useNotes() {
  const api = useApi();
  return useQuery({ queryKey: NOTES_KEY, queryFn: () => api.get('/api/notes', NoteList) });
}

export function useCreateNote() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateNoteInput) => api.post('/api/notes', input, Note),
    // Refetch rather than patch the cache: the server decides order and timestamps.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}

export function useDeleteNote() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/notes/${encodeURIComponent(id)}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTES_KEY }),
  });
}
