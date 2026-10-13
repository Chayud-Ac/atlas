import { CreateNoteInput, type Note } from '@atlas/shared';
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  makeStyles,
  Spinner,
  Text,
  Textarea,
  Title2,
  tokens,
} from '@fluentui/react-components';
import { type SubmitEvent, useState } from 'react';
import { z } from 'zod';
import { ApiError } from '../api.js';
import { ErrorMessage } from '../error-message.js';
import { useCreateNote, useDeleteNote, useNotes } from './notes.api.js';

type FieldErrors = Partial<Record<keyof CreateNoteInput, string>>;

const useStyles = makeStyles({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    marginBlock: tokens.spacingVerticalL,
  },
  list: {
    listStyleType: 'none',
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  body: { whiteSpace: 'pre-wrap' },
});

/** The reference feature: create, list and delete your own notes. */
export function NotesPage() {
  return (
    <section>
      <Title2 as="h1">Notes</Title2>
      <CreateNoteForm />
      <NoteList />
    </section>
  );
}

function CreateNoteForm() {
  const styles = useStyles();
  const createNote = useCreateNote();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    createNote.reset();
    // The schema the API validates with, so most mistakes never leave the browser.
    const parsed = CreateNoteInput.safeParse({ title, body });
    if (!parsed.success) {
      const { fieldErrors: errors } = z.flattenError(parsed.error);
      setFieldErrors({ title: errors.title?.[0], body: errors.body?.[0] });
      return;
    }
    setFieldErrors({});
    createNote.mutate(parsed.data, {
      onSuccess: () => {
        setTitle('');
        setBody('');
      },
      onError: (error) => {
        if (error instanceof ApiError) setFieldErrors(fieldErrorsFrom(error));
      },
    });
  }

  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);
  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <Field label="Title" required validationMessage={fieldErrors.title}>
        <Input
          value={title}
          onChange={(_, data) => {
            setTitle(data.value);
          }}
        />
      </Field>
      <Field label="Body" validationMessage={fieldErrors.body}>
        <Textarea
          value={body}
          onChange={(_, data) => {
            setBody(data.value);
          }}
        />
      </Field>
      {createNote.isError && !hasFieldErrors && <ErrorMessage error={createNote.error} />}
      <div>
        <Button type="submit" appearance="primary" disabled={createNote.isPending}>
          Add note
        </Button>
      </div>
    </form>
  );
}

/** Field errors from a 400 problem, keyed by the fields this form has. */
function fieldErrorsFrom(error: ApiError): FieldErrors {
  const errors: FieldErrors = {};
  for (const { path, message } of error.problem.errors ?? []) {
    if (path === 'title' || path === 'body') errors[path] ??= message;
  }
  return errors;
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

function NoteCard({
  note,
  deleting,
  onDelete,
}: {
  note: Note;
  deleting: boolean;
  onDelete: () => void;
}) {
  const styles = useStyles();
  return (
    <Card>
      <CardHeader
        header={<Text weight="semibold">{note.title}</Text>}
        description={<Text size={200}>{new Date(note.createdAt).toLocaleString()}</Text>}
        action={
          <Button
            appearance="subtle"
            aria-label={`Delete ${note.title}`}
            disabled={deleting}
            onClick={onDelete}
          >
            Delete
          </Button>
        }
      />
      {note.body && <Text className={styles.body}>{note.body}</Text>}
    </Card>
  );
}
