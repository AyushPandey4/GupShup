'use client';

import { useState } from 'react';
import { Moon, Sun, Languages, Volume2, Bell } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [language, setLanguage] = useState('english');
  const [messageRetention, setMessageRetention] = useState('forever');
  const [fontSize, setFontSize] = useState([14]);

  const handleReset = () => {
    setNotificationsEnabled(true);
    setSoundsEnabled(true);
    setLanguage('english');
    setMessageRetention('forever');
    setFontSize([14]);
    setTheme('system');
    
    toast('All settings have been reset to default values', { variant: 'success' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-2">
          {/* Appearance */}
          <div className="space-y-3">
            <h3 className="font-semibold">Appearance</h3>
            
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                <Label>Theme</Label>
              </div>
              <Select 
                value={theme || 'system'} 
                onValueChange={setTheme}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Select theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-1">
              <div className="flex justify-between">
                <Label>Font Size ({fontSize}px)</Label>
              </div>
              <Slider 
                value={fontSize} 
                min={12} 
                max={20} 
                step={1}
                onValueChange={setFontSize} 
              />
            </div>
          </div>
          
          {/* Notifications */}
          <div className="space-y-3 pt-3 border-t">
            <h3 className="font-semibold">Notifications & Sounds</h3>
            
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Bell size={18} />
                <Label>Enable Notifications</Label>
              </div>
              <Switch 
                checked={notificationsEnabled} 
                onCheckedChange={setNotificationsEnabled} 
              />
            </div>
            
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Volume2 size={18} />
                <Label>Enable Sounds</Label>
              </div>
              <Switch 
                checked={soundsEnabled} 
                onCheckedChange={setSoundsEnabled} 
              />
            </div>
          </div>
          
          {/* Privacy & Data */}
          <div className="space-y-3 pt-3 border-t">
            <h3 className="font-semibold">Privacy & Data</h3>
            
            <div className="flex justify-between items-center">
              <Label>Message Retention</Label>
              <Select 
                value={messageRetention} 
                onValueChange={setMessageRetention}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30days">30 days</SelectItem>
                  <SelectItem value="90days">90 days</SelectItem>
                  <SelectItem value="1year">1 year</SelectItem>
                  <SelectItem value="forever">Forever</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Language */}
          <div className="space-y-3 pt-3 border-t">
            <h3 className="font-semibold">Language</h3>
            
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Languages size={18} />
                <Label>App Language</Label>
              </div>
              <Select 
                value={language} 
                onValueChange={setLanguage}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="english">English</SelectItem>
                  <SelectItem value="spanish">Spanish</SelectItem>
                  <SelectItem value="french">French</SelectItem>
                  <SelectItem value="german">German</SelectItem>
                  <SelectItem value="chinese">Chinese</SelectItem>
                  <SelectItem value="japanese">Japanese</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex justify-end pt-3 border-t">
            <Button variant="outline" onClick={handleReset}>
              Reset to Defaults
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}