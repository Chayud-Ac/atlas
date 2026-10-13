import { makeStyles, Spinner, Text, Title2, tokens } from '@fluentui/react-components';
import { ErrorMessage } from '@/components/error-message';
import { useDeleteNote, useNotes } from '../api/use-notes';
import { NoteCard } from './note-card';
import { NoteForm } from './note-form';

const useStyles = makeStyles({
  list: {
    listStyleType: 'none',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
});

/** The reference feature's page: create, list and delete your own notes. */
export function NotesPage() {
  return (
    <section>
      <Title2 as="h1">Notes</Title2>
      <NoteForm />
      <NoteList />
    </section>
  );
}

function NoteList() {
  const styles = useStyles();
  const notes = useNotes();
  const deleteNote = useDeleteNote();

  if (notes.isPending) return <Spinner label="Loading notes" />;
  if (notes.isError) return <ErrorMessage error={notes.error} />;
  if (notes.data.length === 0) return <Text>No notes yet.</Text>;

  return (
    <>
      {deleteNote.isError && <ErrorMessage error={deleteNote.error} />}
      <ul className={styles.list} aria-label="Notes">
        {notes.data.map((note) => (
          <li key={note.id}>
            <NoteCard
              note={note}
              deleting={deleteNote.isPending && deleteNote.variables === note.id}
              onDelete={() => {
                deleteNote.mutate(note.id);
              }}
            />
          </li>
        ))}
      </ul>
    </>
  );
}
