import React from 'react';
import { Play, Pause } from 'lucide-react';

export default function TrackPlayButton({ title, active = false, playing = false, number, onClick }) {
  const running = active && playing;
  return <button type="button" className={`catalog-play-button${active ? ' is-active' : ''}${running ? ' is-playing' : ''}`}
    aria-label={`${running ? 'Pausar' : 'Reproduzir'} ${title}`} aria-pressed={running} onClick={onClick}>
    {number != null && <span className="catalog-play-number" aria-hidden="true">{number}</span>}
    <span className="catalog-play-icon" aria-hidden="true"><Play size={17} fill="currentColor" /></span>
    <span className="catalog-play-pause" aria-hidden="true"><Pause size={17} fill="currentColor" /></span>
    <span className="catalog-playing-bars" aria-hidden="true"><i /><i /><i /><i /></span>
  </button>;
}
