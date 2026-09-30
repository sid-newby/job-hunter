import React, { useEffect, useState } from 'react';
import { Autocomplete, Box, Chip, TextField, TextFieldProps, Typography } from '@mui/material';

export const TEAL = '#14B8A6';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

export const panelSx = { p: 2.5, bgcolor: '#0E131F', border: '1px solid #1F2937', borderRadius: 2 } as const;
export const fieldSx = { '& .MuiInputBase-root': { bgcolor: '#0B0F19' } } as const;

export function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'text.primary' }}>{children}</Typography>
      {hint && <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>{hint}</Typography>}
    </Box>
  );
}

export function LogBox({ lines, empty = 'Starting...', maxHeight = 260 }: { lines: string[]; empty?: string; maxHeight?: number }) {
  const ref = React.useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <Box
      component="pre"
      ref={ref}
      sx={{ m: 0, maxHeight, overflow: 'auto', textAlign: 'left', fontSize: 11, fontFamily: MONO, color: '#9CA3AF', bgcolor: '#0B0F19', p: 1.5, borderRadius: 1, border: '1px solid #1F2937', whiteSpace: 'pre-wrap' }}
    >
      {lines.slice(-200).join('\n') || empty}
    </Box>
  );
}

const parseLines = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean);
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Multiline text bound to a string[] (one item per line); keeps raw text so blank lines survive while typing. */
export function LinesField({ value, onChange, ...props }: { value: string[]; onChange: (v: string[]) => void } & Omit<TextFieldProps, 'value' | 'onChange'>) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => {
    if (!sameList(parseLines(text), value)) setText(value.join('\n'));
  }, [value]);
  return (
    <TextField
      multiline
      minRows={3}
      fullWidth
      size="small"
      sx={fieldSx}
      {...props}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseLines(e.target.value));
      }}
    />
  );
}

/** Free-form chip list: Enter or blur adds the typed value. */
export function ChipsInput({ value, onChange, label, placeholder, helperText }: {
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
  placeholder?: string;
  helperText?: string;
}) {
  const [input, setInput] = useState('');
  const add = (raw: string) => {
    const item = raw.trim();
    if (item && !value.includes(item)) onChange([...value, item]);
    setInput('');
  };
  return (
    <Autocomplete<string, true, false, true>
      multiple
      freeSolo
      options={[]}
      value={value}
      inputValue={input}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, v) => onChange(v.map((s) => s.trim()).filter(Boolean))}
      renderTags={(tags, getTagProps) =>
        tags.map((tag, i) => {
          const { key, ...rest } = getTagProps({ index: i });
          return <Chip key={key} {...rest} label={tag} size="small" sx={{ bgcolor: 'rgba(20, 184, 166, 0.15)', color: '#2DD4BF' }} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          label={label}
          placeholder={value.length ? undefined : placeholder}
          helperText={helperText}
          onBlur={() => input.trim() && add(input)}
          sx={fieldSx}
        />
      )}
    />
  );
}
