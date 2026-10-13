import type { Note } from '@atlas/shared';
import { Button, Card, CardHeader, makeStyles, Text } from '@fluentui/react-components';

const useStyles = makeStyles({
  body: { whiteSpace: 'pre-wrap' },
});

interface NoteCardProps {
  note: Note;
  deleting: boolean;
  onDelete: () => void;
}

/** One note, with its delete button. */
export function NoteCard({ note, deleting, onDelete }: NoteCardProps) {
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
