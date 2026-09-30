import React, { useState } from 'react';
import {
  Box,
  Button,
  Collapse,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Tooltip,
} from '@mui/material';
import { Add as AddIcon, DeleteOutline as DeleteIcon, Tune as TuneIcon } from '@mui/icons-material';
import { Board, Profile } from '../types';
import { ChipsInput, LinesField, MONO, SectionTitle, TEAL, fieldSx, panelSx } from './common';

const str = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.join('\n') : v == null ? '' : String(v));
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => list(v).map(str).filter(Boolean);

/** Fill every field the form binds to, keeping any extra keys so they round-trip to the server. */
export function normalizeProfile(raw: unknown): Profile {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const c = p.candidate ?? {};
  const s = p.search ?? {};
  const sc = p.scoring ?? {};
  const r = p.resume ?? {};
  return {
    ...p,
    candidate: {
      ...c,
      name: str(c.name),
      headline: str(c.headline),
      location: str(c.location),
      email: str(c.email),
      phone: str(c.phone),
      website: str(c.website),
      linkedin: str(c.linkedin),
      summary: str(c.summary),
    },
    search: {
      ...s,
      country: str(s.country),
      remote_ok: s.remote_ok === undefined ? true : Boolean(s.remote_ok),
      metros: list(s.metros).map((m) => ({ ...m, key: str(m?.key), label: str(m?.label), search: str(m?.search), signal: str(m?.signal) })),
      title_keywords: strs(s.title_keywords),
      exclude_title_keywords: strs(s.exclude_title_keywords),
      target_companies: strs(s.target_companies),
      boards: list(s.boards).map((b) => ({ ...b, company: str(b?.company), ats: b?.ats === 'ashby' ? 'ashby' : 'greenhouse', slug: str(b?.slug) })),
      scopes: list(s.scopes).map((x) => ({
        ...x,
        key: str(x?.key),
        label: str(x?.label),
        brief: str(x?.brief),
        queries: strs(x?.queries),
        location_gate: Boolean(x?.location_gate),
      })),
      exclude_domains: strs(s.exclude_domains),
    },
    scoring: {
      ...sc,
      bullseye: strs(sc.bullseye),
      strong_fit: str(sc.strong_fit),
      priority_bonus: strs(sc.priority_bonus),
      low_fit: strs(sc.low_fit),
    },
    resume: { ...r, positioning: str(r.positioning), rules: strs(r.rules), accent_color: str(r.accent_color) },
  } as Profile;
}

const CANDIDATE_FIELDS: [keyof Profile['candidate'], string, number][] = [
  ['name', 'Name', 6],
  ['headline', 'Headline', 6],
  ['location', 'Location', 4],
  ['email', 'Email', 4],
  ['phone', 'Phone', 4],
  ['website', 'Website', 6],
  ['linkedin', 'LinkedIn', 6],
];

const rowSx = { p: 1.5, mb: 1, bgcolor: '#111827', border: '1px solid #1F2937', borderRadius: 1.5 } as const;

function RemoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <Tooltip title={title}>
      <IconButton size="small" onClick={onClick} sx={{ color: '#EF4444' }}>
        <DeleteIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button size="small" startIcon={<AddIcon />} onClick={onClick} sx={{ color: TEAL }}>
      {children}
    </Button>
  );
}

export default function ProfileForm({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  const [showSignals, setShowSignals] = useState(false);
  const edit = (fn: (d: Profile) => void) => {
    const d = structuredClone(value);
    fn(d);
    onChange(d);
  };
  const { candidate: c, search: s, scoring: sc, resume: r } = value;
  const colorOk = /^#[0-9a-f]{6}$/i.test(r.accent_color);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Printed at the top of every tailored resume.">Candidate</SectionTitle>
        <Grid container spacing={2}>
          {CANDIDATE_FIELDS.map(([k, label, sm]) => (
            <Grid item xs={12} sm={sm} key={k}>
              <TextField fullWidth size="small" label={label} value={c[k]} onChange={(e) => edit((d) => { d.candidate[k] = e.target.value; })} sx={fieldSx} />
            </Grid>
          ))}
          <Grid item xs={12}>
            <TextField fullWidth multiline minRows={3} size="small" label="Summary" value={c.summary} onChange={(e) => edit((d) => { d.candidate.summary = e.target.value; })} sx={fieldSx} />
          </Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Where discovery looks and which postings it keeps.">Search</SectionTitle>
        <Grid container spacing={2} alignItems="center" sx={{ mb: 2.5 }}>
          <Grid item xs={12} sm={4}>
            <TextField fullWidth size="small" label="Country" value={s.country} onChange={(e) => edit((d) => { d.search.country = e.target.value; })} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} sm={8}>
            <FormControlLabel
              control={<Switch checked={s.remote_ok} onChange={(e) => edit((d) => { d.search.remote_ok = e.target.checked; })} />}
              label="Open to remote roles"
            />
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <SectionTitle hint="Key is the short id used in filters; search is the place phrase added to queries.">Target metros</SectionTitle>
          <Button size="small" startIcon={<TuneIcon />} onClick={() => setShowSignals((v) => !v)} sx={{ color: 'text.secondary' }}>
            {showSignals ? 'Hide advanced' : 'Advanced'}
          </Button>
        </Box>
        {s.metros.map((m, i) => (
          <Box key={i} sx={rowSx}>
            <Grid container spacing={1.5} alignItems="center">
              <Grid item xs={12} sm={2}>
                <TextField fullWidth size="small" label="Key" value={m.key} onChange={(e) => edit((d) => { d.search.metros[i].key = e.target.value; })} sx={fieldSx} />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField fullWidth size="small" label="Label" value={m.label} onChange={(e) => edit((d) => { d.search.metros[i].label = e.target.value; })} sx={fieldSx} />
              </Grid>
              <Grid item xs={11} sm={5}>
                <TextField fullWidth size="small" label="Search phrase" value={m.search} onChange={(e) => edit((d) => { d.search.metros[i].search = e.target.value; })} sx={fieldSx} />
              </Grid>
              <Grid item xs={1} sx={{ textAlign: 'right' }}>
                <RemoveButton title="Remove metro" onClick={() => edit((d) => { d.search.metros.splice(i, 1); })} />
              </Grid>
            </Grid>
            <Collapse in={showSignals}>
              <TextField
                fullWidth
                size="small"
                label="Location signal (regex)"
                value={m.signal}
                onChange={(e) => edit((d) => { d.search.metros[i].signal = e.target.value; })}
                helperText="Case-insensitive regex matched against location, work arrangement, URL, and posting text."
                InputProps={{ sx: { fontFamily: MONO, fontSize: 13 } }}
                sx={{ ...fieldSx, mt: 1.5 }}
              />
            </Collapse>
          </Box>
        ))}
        <AddButton onClick={() => edit((d) => { d.search.metros.push({ key: '', label: '', search: '', signal: '' }); })}>Add metro</AddButton>

        <Grid container spacing={2} sx={{ mt: 1.5 }}>
          <Grid item xs={12} md={6}>
            <ChipsInput label="Title keywords" value={s.title_keywords} onChange={(v) => edit((d) => { d.search.title_keywords = v; })} helperText="Titles worth a look. Press Enter to add." />
          </Grid>
          <Grid item xs={12} md={6}>
            <ChipsInput label="Exclude title keywords" value={s.exclude_title_keywords} onChange={(v) => edit((d) => { d.search.exclude_title_keywords = v; })} helperText="Titles to drop outright." />
          </Grid>
          <Grid item xs={12} md={6}>
            <ChipsInput label="Target companies" value={s.target_companies} onChange={(v) => edit((d) => { d.search.target_companies = v; })} />
          </Grid>
          <Grid item xs={12} md={6}>
            <ChipsInput label="Exclude domains" value={s.exclude_domains} onChange={(v) => edit((d) => { d.search.exclude_domains = v; })} helperText="Sites whose results are ignored, e.g. aggregators." />
          </Grid>
        </Grid>

        <Box sx={{ mt: 3 }}>
          <SectionTitle hint="Public ATS boards polled directly. The slug is the board id in the URL (boards.greenhouse.io/<slug>, jobs.ashbyhq.com/<slug>).">Job boards</SectionTitle>
          {s.boards.map((b, i) => (
            <Box key={i} sx={rowSx}>
              <Grid container spacing={1.5} alignItems="center">
                <Grid item xs={12} sm={5}>
                  <TextField fullWidth size="small" label="Company" value={b.company} onChange={(e) => edit((d) => { d.search.boards[i].company = e.target.value; })} sx={fieldSx} />
                </Grid>
                <Grid item xs={12} sm={3}>
                  <FormControl fullWidth size="small">
                    <InputLabel>ATS</InputLabel>
                    <Select label="ATS" value={b.ats} onChange={(e) => edit((d) => { d.search.boards[i].ats = e.target.value as Board['ats']; })} sx={{ bgcolor: '#0B0F19' }}>
                      <MenuItem value="greenhouse">Greenhouse</MenuItem>
                      <MenuItem value="ashby">Ashby</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>
                <Grid item xs={11} sm={3}>
                  <TextField fullWidth size="small" label="Slug" value={b.slug} onChange={(e) => edit((d) => { d.search.boards[i].slug = e.target.value; })} InputProps={{ sx: { fontFamily: MONO, fontSize: 13 } }} sx={fieldSx} />
                </Grid>
                <Grid item xs={1} sx={{ textAlign: 'right' }}>
                  <RemoveButton title="Remove board" onClick={() => edit((d) => { d.search.boards.splice(i, 1); })} />
                </Grid>
              </Grid>
            </Box>
          ))}
          <AddButton onClick={() => edit((d) => { d.search.boards.push({ company: '', ats: 'greenhouse', slug: '' }); })}>Add board</AddButton>
        </Box>

        <Box sx={{ mt: 3 }}>
          <SectionTitle hint="Each scope is a named hunt: a brief for the discovery agent plus its search queries. Location gate keeps only postings in your metros or remote.">
            Scopes
          </SectionTitle>
          <Grid container spacing={2}>
            {s.scopes.map((x, i) => (
              <Grid item xs={12} md={6} key={i}>
                <Box sx={{ ...rowSx, mb: 0, height: '100%' }}>
                  <Grid container spacing={1.5} alignItems="center">
                    <Grid item xs={4}>
                      <TextField fullWidth size="small" label="Key" value={x.key} onChange={(e) => edit((d) => { d.search.scopes[i].key = e.target.value; })} sx={fieldSx} />
                    </Grid>
                    <Grid item xs={7}>
                      <TextField fullWidth size="small" label="Label" value={x.label} onChange={(e) => edit((d) => { d.search.scopes[i].label = e.target.value; })} sx={fieldSx} />
                    </Grid>
                    <Grid item xs={1} sx={{ textAlign: 'right' }}>
                      <RemoveButton title="Remove scope" onClick={() => edit((d) => { d.search.scopes.splice(i, 1); })} />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField fullWidth multiline minRows={2} size="small" label="Brief" value={x.brief} onChange={(e) => edit((d) => { d.search.scopes[i].brief = e.target.value; })} sx={fieldSx} />
                    </Grid>
                    <Grid item xs={12}>
                      <LinesField label="Queries (one per line)" value={x.queries} onChange={(v) => edit((d) => { d.search.scopes[i].queries = v; })} />
                    </Grid>
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={<Switch size="small" checked={x.location_gate} onChange={(e) => edit((d) => { d.search.scopes[i].location_gate = e.target.checked; })} />}
                        label="Location gate"
                      />
                    </Grid>
                  </Grid>
                </Box>
              </Grid>
            ))}
          </Grid>
          <Box sx={{ mt: 1 }}>
            <AddButton onClick={() => edit((d) => { d.search.scopes.push({ key: '', label: '', brief: '', queries: [], location_gate: true }); })}>Add scope</AddButton>
          </Box>
        </Box>
      </Paper>

      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Guides the qualify model when it scores each posting 0-100.">Scoring</SectionTitle>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>
            <LinesField label="Bullseye roles (one per line)" value={sc.bullseye} onChange={(v) => edit((d) => { d.scoring.bullseye = v; })} />
          </Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth multiline minRows={3} size="small" label="Strong fit" value={sc.strong_fit} onChange={(e) => edit((d) => { d.scoring.strong_fit = e.target.value; })} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} md={6}>
            <LinesField label="Priority bonus signals (one per line)" value={sc.priority_bonus} onChange={(v) => edit((d) => { d.scoring.priority_bonus = v; })} />
          </Grid>
          <Grid item xs={12} md={6}>
            <LinesField label="Low-fit signals (one per line)" value={sc.low_fit} onChange={(v) => edit((d) => { d.scoring.low_fit = v; })} />
          </Grid>
        </Grid>
      </Paper>

      <Paper elevation={0} sx={panelSx}>
        <SectionTitle hint="Defaults for the tailor model and the rendered PDF.">Resume</SectionTitle>
        <Grid container spacing={2}>
          <Grid item xs={12} md={8}>
            <TextField fullWidth size="small" label="Default positioning" value={r.positioning} onChange={(e) => edit((d) => { d.resume.positioning = e.target.value; })} sx={fieldSx} />
          </Grid>
          <Grid item xs={12} md={4}>
            <TextField
              fullWidth
              size="small"
              label="Accent color"
              value={r.accent_color}
              onChange={(e) => edit((d) => { d.resume.accent_color = e.target.value; })}
              error={Boolean(r.accent_color) && !colorOk}
              InputProps={{
                startAdornment: (
                  <Box
                    component="input"
                    type="color"
                    value={colorOk ? r.accent_color : TEAL}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => edit((d) => { d.resume.accent_color = e.target.value; })}
                    sx={{ width: 28, height: 28, p: 0, mr: 1, border: 'none', bgcolor: 'transparent', cursor: 'pointer' }}
                  />
                ),
              }}
              sx={fieldSx}
            />
          </Grid>
          <Grid item xs={12}>
            <LinesField label="Resume rules (one per line)" value={r.rules} onChange={(v) => edit((d) => { d.resume.rules = v; })} />
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
}
