'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { useChat } from '@/contexts/chat-context';
import { useToast } from '@/hooks/use-toast';

interface CreateGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateGroupDialog({ open, onOpenChange }: CreateGroupDialogProps) {
  const { contacts, createGroup, searchUsers } = useChat();
  const { toast } = useToast();
  const [groupName, setGroupName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<typeof contacts>([]);


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



  const filteredContacts = contacts.filter(contact =>
  (contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    contact.username.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const toggleContactSelection = (contactId: string) => {
    if (selectedContacts.includes(contactId)) {
      setSelectedContacts(selectedContacts.filter(id => id !== contactId));
    } else {
      setSelectedContacts([...selectedContacts, contactId]);
    }
  };

  const removeSelectedContact = (contactId: string) => {
    setSelectedContacts(selectedContacts.filter(id => id !== contactId));
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast('Please enter a name for the group.', {
        variant: 'warning'
      });
      return;
    }

    if (selectedContacts.length < 1) {
      toast('Please select at least one contact to create a group.', {
        variant: 'warning'
      });
      return;
    }

    try {
      await createGroup(groupName, selectedContacts);
      toast(`"${groupName}" has been created successfully.`, {
        variant: 'success'
      });
      setGroupName('');
      setSelectedContacts([]);
      onOpenChange(false);
    } catch (error) {
      toast('Failed to create group. Please try again.', {
        variant: 'error'
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              placeholder="Enter group name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
            />
          </div>

          {selectedContacts.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedContacts.map(contactId => {
                const contact = contacts.find(c => c.id === contactId);
                return (
                  <Badge key={contactId} variant="secondary" className="gap-1 px-2 py-1">
                    {contact?.name}
                    <X
                      size={14}
                      className="cursor-pointer ml-1"
                      onClick={() => removeSelectedContact(contactId)}
                    />
                  </Badge>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search contacts to add..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <ScrollArea className="h-[250px]">
            <div className="space-y-1">
              {(searchQuery ? searchResults : contacts).length > 0 ? (
                (searchQuery ? searchResults : contacts).map((contact) => (

                  <div
                    key={contact.id}
                    className="flex items-center p-2 rounded-md cursor-pointer hover:bg-accent/50 transition-colors"
                  >
                    <Checkbox
                      checked={selectedContacts.includes(contact.id)}
                      onCheckedChange={() => toggleContactSelection(contact.id)}
                      className="mr-3"
                    />
                    <Avatar>
                      <AvatarImage src={contact.profilePicture} />
                      <AvatarFallback>{contact.name[0]}</AvatarFallback>
                    </Avatar>
                    <div className="ml-3">
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">@{contact.username}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-12 text-center text-muted-foreground">
                  {searchQuery ? 'No contacts match your search' : 'No contacts found'}
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreateGroup}>Create Group</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}