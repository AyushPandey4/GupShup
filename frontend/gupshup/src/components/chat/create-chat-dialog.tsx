'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useChat } from '@/contexts/chat-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils'; // optional helper for merging classes

interface CreateChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChatDialog({ open, onOpenChange }: CreateChatDialogProps) {
  const { contacts, openChat, searchUsers } = useChat();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        handleSearch(searchQuery);
      } else {
        setSearchResults([]); // fallback to local contacts if search is empty
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    const results = await searchUsers(query);
    setSearchResults(results);
    setIsSearching(false);
  };

  const filteredContacts =
    searchQuery.trim().length >= 2 ? searchResults : contacts;

  const handleStartChat = async (contact: any) => {
    try {
      setIsLoading(true);
      console.log('Starting chat with:', contact);
      await openChat(null, contact);
      onOpenChange(false);
      toast(`Started a chat with ${contact.name}`, {
        variant: 'success'
      });
    } catch (error) {
      toast('Failed to start chat. Please try again.', {
        variant: 'error'
      });
      
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>New Chat</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[300px]">
            <div className="space-y-1">
              {isSearching ? (
                <div className="py-12 text-center text-muted-foreground">
                  Searching...
                </div>
              ) : filteredContacts.length > 0 ? (
                filteredContacts.map((contact) => (
                  <Button
                    key={contact._id || contact.id}
                    variant="ghost"
                    className={cn('w-full justify-start p-2', {
                      'opacity-60 pointer-events-none': isLoading,
                    })}
                    onClick={() => handleStartChat(contact)}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={contact.profilePicture} />
                        <AvatarFallback>{contact.name?.[0]}</AvatarFallback>
                      </Avatar>
                      <div className="text-left">
                        <p className="font-medium">{contact.name}</p>
                        <p className="text-xs text-muted-foreground">@{contact.username}</p>
                      </div>
                    </div>
                  </Button>
                ))
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  {searchQuery ? 'No users match your search' : 'No contacts found'}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
