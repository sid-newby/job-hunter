import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  InsertDriveFile as FileIcon,
  DeleteOutline as DeleteIcon,
  Mic as MicIcon,
  MicOff as MicOffIcon,
} from '@mui/icons-material';
import { del, errMsg, getJSON, postForm, putJSON } from '../api';
import { UploadFile } from '../types';
import { SectionTitle, TEAL, fieldSx, panelSx } from './common';

const ACCEPT = ['.pdf', '.docx', '.md', '.txt', '.html', '.csv', '.json'];
const MIN_CHARS = 200;

interface SpeechAlternative { transcript: string }
interface SpeechResult { isFinal: boolean; length: number; [index: number]: SpeechAlternative }
interface SpeechResultEvent { resultIndex: number; results: { length: number; [index: number]: SpeechResult } }
interface Recognizer {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognizerCtor = new () => Recognizer;

const recognizerCtor = (): RecognizerCtor | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognizerCtor; webkitSpeechRecognition?: RecognizerCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

const appendText = (base: string, add: string) => {
  const piece = add.trim();
  if (!piece) return base;
  if (!base) return piece;
  return /\s$/.test(base) ? base + piece : `${base} ${piece}`;
};

export default function AboutYouStep({ onReadyChange, active = true }: { onReadyChange?: (ready: boolean) => void; active?: boolean }) {
  const [uploads, setUploads] = useState<UploadFile[]>([]);
  const [uploadsError, setUploadsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedText = useRef('');
  const pending = useRef<string | null>(null);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState<string | null>(null);
  const recognizer = useRef<Recognizer | null>(null);
  const wantListening = useRef(false);
  const speechSupported = Boolean(recognizerCtor());

  const loadAll = async () => {
    setLoadError(null);
    setUploadsError(null);
    const [up, iv] = await Promise.allSettled([
      getJSON<UploadFile[]>('/api/setup/uploads'),
      getJSON<{ text: string }>('/api/setup/interview'),
    ]);
    if (up.status === 'fulfilled') setUploads(up.value || []);
    else setUploadsError(errMsg(up.reason));
    if (iv.status === 'fulfilled') {
      const t = iv.value?.text ?? '';
      savedText.current = t;
      setText((cur) => (cur.trim() && cur !== t ? appendText(t, cur) : t));
      setLoaded(true);
    } else {
      setLoadError(errMsg(iv.reason));
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const flush = async () => {
    const t = pending.current;
    if (t === null) return;
    pending.current = null;
    setSaveState('saving');
    try {
      await putJSON('/api/setup/interview', { text: t });
      savedText.current = t;
      setSaveState('saved');
      setSaveError(null);
    } catch (err) {
      setSaveState('error');
      setSaveError(errMsg(err));
    }
  };

  useEffect(() => {
    if (!loaded || text === savedText.current) return;
    pending.current = text;
    const timer = setTimeout(flush, 800);
    return () => clearTimeout(timer);
  }, [text, loaded]);

  useEffect(
    () => () => {
      if (pending.current !== null) putJSON('/api/setup/interview', { text: pending.current }).catch(() => {});
      wantListening.current = false;
      recognizer.current?.stop();
    },
    [],
  );

  const ready = uploads.length > 0 || text.trim().length >= MIN_CHARS;
  useEffect(() => {
    onReadyChange?.(ready);
  }, [ready, onReadyChange]);

  const upload = async (files: File[]) => {
    const ok = files.filter((f) => ACCEPT.some((ext) => f.name.toLowerCase().endsWith(ext)));
    setSkipped(files.filter((f) => !ok.includes(f)).map((f) => f.name));
    if (!ok.length) return;
    const form = new FormData();
    ok.forEach((f) => form.append('files', f));
    setUploading(true);
    setUploadsError(null);
    try {
      setUploads(await postForm<UploadFile[]>('/api/setup/uploads', form));
    } catch (err) {
      setUploadsError(errMsg(err));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (name: string) => {
    setUploadsError(null);
    try {
      setUploads(await del<UploadFile[]>(`/api/setup/uploads/${encodeURIComponent(name)}`));
    } catch (err) {
      setUploadsError(errMsg(err));
    }
  };

  const stopListening = () => {
    wantListening.current = false;
    recognizer.current?.stop();
    setListening(false);
    setInterim('');
  };

  const startListening = () => {
    const Ctor = recognizerCtor();
    if (!Ctor) return;
    setMicError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) setText((t) => appendText(t, finalText));
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setMicError(e.error === 'not-allowed' ? 'Microphone access was blocked. Allow it in your browser to dictate.' : `Speech recognition error: ${e.error}`);
      wantListening.current = false;
    };
    // Browsers end continuous sessions after a pause; restart until the user stops.
    rec.onend = () => {
      if (wantListening.current) {
        try {
          rec.start();
          return;
        } catch {
          wantListening.current = false;
        }
      }
      setListening(false);
      setInterim('');
    };
    recognizer.current = rec;
    wantListening.current = true;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setMicError(errMsg(err));
      wantListening.current = false;
    }
  };

  useEffect(() => {
    if (!active && listening) stopListening();
  }, [active, listening]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) upload(Array.from(e.dataTransfer.files));
  };

  const chars = text.trim().length;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Resume (PDF, DOCX, Markdown, or text), a LinkedIn data export (CSV), saved profile pages (HTML), portfolios, performance reviews. Anything that describes your work.">
          Upload artifacts about yourself
        </SectionTitle>
        <Box
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          sx={{
            border: '2px dashed',
            borderColor: dragOver ? TEAL : '#374151',
            bgcolor: dragOver ? 'rgba(20, 184, 166, 0.08)' : '#0B0F19',
            borderRadius: 2,
            py: 4,
            textAlign: 'center',
            transition: 'all 0.15s ease',
          }}
        >
          <CloudUploadIcon sx={{ fontSize: 40, color: dragOver ? TEAL : 'text.secondary' }} />
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 1, mb: 1.5 }}>
            Drag files here, or
          </Typography>
          <Button variant="outlined" onClick={() => fileInput.current?.click()} disabled={uploading} startIcon={uploading ? <CircularProgress size={16} /> : undefined}>
            {uploading ? 'Uploading...' : 'Choose files'}
          </Button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT.join(',')}
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload(Array.from(e.target.files));
              e.target.value = '';
            }}
          />
          <Typography variant="caption" sx={{ display: 'block', color: '#6B7280', mt: 1.5 }}>{ACCEPT.join(' ')}</Typography>
        </Box>

        {skipped.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1.5 }} onClose={() => setSkipped([])}>
            Skipped unsupported files: {skipped.join(', ')}
          </Alert>
        )}
        {uploadsError && <Alert severity="error" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>{uploadsError}</Alert>}

        {uploads.length > 0 && (
          <List dense sx={{ mt: 1 }}>
            {uploads.map((f) => (
              <ListItem
                key={f.name}
                sx={{ bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1, mb: 0.75 }}
                secondaryAction={
                  <Tooltip title="Remove">
                    <IconButton edge="end" size="small" onClick={() => remove(f.name)} sx={{ color: '#EF4444' }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemIcon sx={{ minWidth: 36 }}><FileIcon fontSize="small" sx={{ color: TEAL }} /></ListItemIcon>
                <ListItemText
                  primary={f.name}
                  secondary={[
                    fmtSize(f.size),
                    f.kind,
                    f.extracted_chars != null ? `${f.extracted_chars.toLocaleString()} chars extracted` : 'no text extracted',
                  ].filter(Boolean).join(' · ')}
                  secondaryTypographyProps={{ sx: { color: f.extracted_chars ? 'text.secondary' : '#FBBF24' } }}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Paper elevation={0} sx={panelSx}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2 }}>
          <SectionTitle hint="Type or dictate. Plain talk is fine; the model turns it into your profile. Saved automatically.">
            In your own words
          </SectionTitle>
          <Tooltip title={speechSupported ? (listening ? 'Stop dictation' : 'Dictate with your microphone') : 'Dictation needs a browser with the Web Speech API (Chrome, Edge, or Safari)'}>
            <span>
              <IconButton
                onClick={listening ? stopListening : startListening}
                disabled={!speechSupported}
                sx={{
                  border: '1px solid',
                  borderColor: listening ? '#EF4444' : 'rgba(20, 184, 166, 0.4)',
                  color: listening ? '#EF4444' : TEAL,
                  bgcolor: listening ? 'rgba(239, 68, 68, 0.12)' : 'rgba(20, 184, 166, 0.08)',
                }}
              >
                {speechSupported ? (listening ? <MicOffIcon /> : <MicIcon />) : <MicOffIcon />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>

        {loadError && (
          <Alert severity="error" sx={{ mb: 1.5 }} action={<Button color="inherit" size="small" onClick={loadAll}>Retry</Button>}>
            Couldn't load your saved notes ({loadError}). Edits won't be saved until this loads.
          </Alert>
        )}
        {micError && <Alert severity="warning" sx={{ mb: 1.5 }} onClose={() => setMicError(null)}>{micError}</Alert>}

        <TextField
          fullWidth
          multiline
          minRows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!loaded && !loadError}
          placeholder="Tell us about yourself: what you've done, what you want next, where you want to work, deal-breakers, compensation, companies you admire…"
          sx={fieldSx}
        />
        {listening && (
          <Typography variant="caption" sx={{ display: 'block', mt: 1, color: TEAL, fontStyle: 'italic' }}>
            Listening… {interim}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
          <Typography variant="caption" sx={{ color: chars >= MIN_CHARS || uploads.length ? 'text.secondary' : '#FBBF24' }}>
            {chars.toLocaleString()} characters{chars < MIN_CHARS && !uploads.length ? ` (upload a file or write at least ${MIN_CHARS})` : ''}
          </Typography>
          <Typography variant="caption" sx={{ color: saveState === 'error' ? '#EF4444' : 'text.secondary' }}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? `Not saved: ${saveError}` : ''}
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}
