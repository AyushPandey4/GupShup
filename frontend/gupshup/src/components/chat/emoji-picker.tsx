'use client';

import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

// Simple emoji picker with common emojis
export function EmojiPicker({ onSelect }: EmojiPickerProps) {
  const [activeTab, setActiveTab] = useState('smileys');
  
  const smileyEmojis = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇'];
  const handEmojis = ['👍', '👎', '👏', '🙌', '👐', '🤝', '🤲', '🤞', '✌️', '🤟', '🤘', '👌', '🤌', '🤏'];
  const animalEmojis = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸'];
  const objectEmojis = ['❤️', '🔥', '🎉', '🎁', '✨', '⭐', '🌟', '💯', '💤', '💪', '👀', '🍺', '🍕', '🚀'];

  const pickerRef = useRef<HTMLDivElement>(null);

  // Handle tab switching
  const handleTabClick = (tab: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Tab clicked:', tab);
    setActiveTab(tab);
  };

  // Handle emoji selection
  const handleEmojiClick = (emoji: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Emoji clicked:', emoji);
    onSelect(emoji);
  };

  return (
    <Card 
      className="p-3 w-[280px] shadow-lg z-[9999] bg-background border" 
      ref={pickerRef} 
      onClick={(e) => e.stopPropagation()}
    >
      {/* Custom tabs instead of using the Tabs component */}
      <div className="grid grid-cols-4 gap-1 mb-3">
        <button 
          className={`p-1 rounded ${activeTab === 'smileys' ? 'bg-accent' : 'hover:bg-muted'}`}
          onClick={handleTabClick('smileys')}
          type="button"
        >
          😀
        </button>
        <button 
          className={`p-1 rounded ${activeTab === 'hands' ? 'bg-accent' : 'hover:bg-muted'}`}
          onClick={handleTabClick('hands')}
          type="button"
        >
          👍
        </button>
        <button 
          className={`p-1 rounded ${activeTab === 'animals' ? 'bg-accent' : 'hover:bg-muted'}`}
          onClick={handleTabClick('animals')}
          type="button"
        >
          🐶
        </button>
        <button 
          className={`p-1 rounded ${activeTab === 'objects' ? 'bg-accent' : 'hover:bg-muted'}`}
          onClick={handleTabClick('objects')}
          type="button"
        >
          🎁
        </button>
      </div>

      {/* Tab content */}
      <div className="grid grid-cols-7 gap-1">
        {activeTab === 'smileys' && smileyEmojis.map((emoji) => (
          <button
            key={emoji}
            onClick={handleEmojiClick(emoji)}
            className="text-xl p-1 hover:bg-accent rounded-md transition-colors"
            type="button"
          >
            {emoji}
          </button>
        ))}
        {activeTab === 'hands' && handEmojis.map((emoji) => (
          <button
            key={emoji}
            onClick={handleEmojiClick(emoji)}
            className="text-xl p-1 hover:bg-accent rounded-md transition-colors"
            type="button"
          >
            {emoji}
          </button>
        ))}
        {activeTab === 'animals' && animalEmojis.map((emoji) => (
          <button
            key={emoji}
            onClick={handleEmojiClick(emoji)}
            className="text-xl p-1 hover:bg-accent rounded-md transition-colors"
            type="button"
          >
            {emoji}
          </button>
        ))}
        {activeTab === 'objects' && objectEmojis.map((emoji) => (
          <button
            key={emoji}
            onClick={handleEmojiClick(emoji)}
            className="text-xl p-1 hover:bg-accent rounded-md transition-colors"
            type="button"
          >
            {emoji}
          </button>
        ))}
      </div>
    </Card>
  );
}