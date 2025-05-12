'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Bell, 
  BellOff, 
  Trash2, 
  LogOut, 
  UserPlus, 
  UserMinus,
  ShieldAlert,
  Users
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/contexts/auth-context';
import { 
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from '@/hooks/use-toast';

interface ChatInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chat: any;
}

export function ChatInfoDialog({ open, onOpenChange, chat }: ChatInfoDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [muted, setMuted] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  
  // Determine if user is admin in group chat
  const isAdmin = chat?.isGroup ? 
    chat.admins?.includes(user?.id) || chat.createdBy === user?.id : 
    false;

  const handleToggleMute = () => {
    setMuted(!muted);
    toast(muted ? 'Notifications enabled' : 'Notifications muted', {
      description: muted ? 
        'You will now receive notifications for this chat.' : 
        'You will no longer receive notifications for this chat.',
    });
  };

  const handleLeaveGroup = () => {
    // This would call an API in a real app
    toast('Left group', {
      description: `You have left "${chat.name}".`,
    });
    setConfirmLeaveOpen(false);
    onOpenChange(false);
  };

  const handleDeleteChat = () => {
    // This would call an API in a real app
    toast('Chat deleted', {
      description: `Chat with ${chat.isGroup ? chat.name : chat.participants[0].name} has been deleted.`,
    });
    setConfirmDeleteOpen(false);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {chat?.isGroup ? 'Group Info' : 'Contact Info'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center pt-4">
            <Avatar className="h-24 w-24">
              <AvatarImage src={chat?.isGroup 
                ? chat.profilePicture 
                : chat?.participants[0].profilePicture} 
              />
              <AvatarFallback>
                {chat?.isGroup 
                  ? chat.name[0]
                  : chat?.participants[0].name[0]}
              </AvatarFallback>
            </Avatar>
            <h3 className="mt-4 text-xl font-semibold">
              {chat?.isGroup 
                ? chat.name
                : chat?.participants[0].name}
            </h3>
            {!chat?.isGroup && (
              <p className="text-sm text-muted-foreground mt-1">
                @{chat?.participants[0].username}
              </p>
            )}
          </div>
          
          <div className="space-y-4">
            {/* Notification settings */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                {muted ? <BellOff size={18} /> : <Bell size={18} />}
                <span>Notifications</span>
              </div>
              <Switch checked={!muted} onCheckedChange={handleToggleMute} />
            </div>
            
            {/* Group members (if group chat) */}
            {chat?.isGroup && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Users size={18} />
                  <span className="font-medium">
                    {chat.participants.length} Members
                  </span>
                </div>
                <ScrollArea className="h-[160px]">
                  {chat.participants.map((participant: any) => (
                    <div key={participant.id} className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={participant.profilePicture} />
                          <AvatarFallback>{participant.name[0]}</AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="text-sm font-medium">{participant.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {participant.id === user?.id ? 'You' : `@${participant.username}`}
                          </p>
                        </div>
                      </div>
                      {(participant.id === chat.createdBy || chat.admins?.includes(participant.id)) && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <ShieldAlert size={14} />
                          <span>Admin</span>
                        </div>
                      )}
                    </div>
                  ))}
                </ScrollArea>
              </div>
            )}
            
            {/* Media and files (placeholder) */}
            <div className="pt-4 border-t">
              <h4 className="font-medium mb-2">Media, files and links</h4>
              <p className="text-sm text-muted-foreground text-center py-4">
                No media or files shared yet
              </p>
            </div>
            
            {/* Action buttons */}
            <div className="flex flex-col gap-2 pt-4 border-t">
              {chat?.isGroup ? (
                <>
                  {isAdmin && (
                    <Button 
                      variant="outline" 
                      className="justify-start gap-2"
                    >
                      <UserPlus size={18} />
                      Add participant
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    className="justify-start gap-2 text-destructive hover:text-destructive"
                    onClick={() => setConfirmLeaveOpen(true)}
                  >
                    <LogOut size={18} />
                    Leave group
                  </Button>
                </>
              ) : (
                <Button 
                  variant="outline" 
                  className="justify-start gap-2 text-destructive hover:text-destructive"
                  onClick={() => setConfirmDeleteOpen(true)}
                >
                  <Trash2 size={18} />
                  Delete chat
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Confirm leave group dialog */}
      <AlertDialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave group?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to leave "{chat?.name}"? You won't receive messages from this group anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeaveGroup} className="bg-destructive">
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      
      {/* Confirm delete chat dialog */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete chat?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this chat? This will remove all messages and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteChat} className="bg-destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}