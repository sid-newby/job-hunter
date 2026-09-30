import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tab, Tabs, Typography } from '@mui/material';
import { Close as CloseIcon, Replay as ReplayIcon, Settings as SettingsIcon } from '@mui/icons-material';
import ModelStep from './ModelStep';
import DatabaseStep from './DatabaseStep';
import ProfileStep from './ProfileStep';
import { TEAL } from './common';

export default function SettingsDialog({ open, onClose, onRerunOrientation }: {
  open: boolean;
  onClose: () => void;
  onRerunOrientation: () => void;
}) {
  const [tab, setTab] = useState(0);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#111827', border: '1px solid #1F2937', backgroundImage: 'none' } }}
    >
      <DialogTitle sx={{ borderBottom: '1px solid #1F2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <SettingsIcon sx={{ color: TEAL }} />
          <Typography component="div" variant="h6" sx={{ fontWeight: 700 }}>Settings</Typography>
        </Box>
        <IconButton onClick={onClose} sx={{ color: 'text.secondary' }}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 3, borderBottom: '1px solid #1F2937' }}>
        <Tab label="Model & keys" />
        <Tab label="Database" />
        <Tab label="Profile" />
      </Tabs>
      <DialogContent sx={{ py: 3, minHeight: 420 }}>
        {tab === 0 && <ModelStep />}
        {tab === 1 && <DatabaseStep />}
        {tab === 2 && <ProfileStep />}
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid #1F2937', px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button startIcon={<ReplayIcon />} onClick={onRerunOrientation} sx={{ color: 'text.secondary' }}>
          Re-run orientation
        </Button>
        <Button variant="outlined" onClick={onClose} sx={{ color: '#E5E7EB', borderColor: '#374151' }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
