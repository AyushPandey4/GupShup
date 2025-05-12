'use client';

import { useState, useMemo, useCallback } from 'react';
import {
  Search,
  Users,
  MessageSquarePlus,
  UserCircle,
  Settings,
  LogOut,
  X,
  Moon,
  Sun,
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/use-toast';
import { useChat } from '@/contexts/chat-context';
import { useSocket } from '@/contexts/socket-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ContactItem } from '@/components/chat/contact-item';
import { GroupItem } from '@/components/chat/group-item';
import { CreateChatDialog } from '@/components/chat/create-chat-dialog';
import { CreateGroupDialog } from '@/components/chat/create-group-dialog';
import { ProfileDialog } from '@/components/chat/profile-dialog';
import { SettingsDialog } from '@/components/chat/settings-dialog';

interface ChatSidebarProps {
  onClose: () => void;
}

export type BaseUser = {
  _id?: string;
  id?: string;
  name: string;
  username?: string;
  profilePicture?: string;
  status?: 'online' | 'offline';
}

export type BaseChat = {
  _id: string;
  id: string;
  isGroup: boolean;
  name?: string;
  participants: BaseUser[];
  lastMessage?: any;
}

type User = BaseUser;
type Chat = BaseChat;

interface TabContentProps<T> {
  value: string;
  items: T[];
  noResultsMessage: string;
  renderItem: (item: T) => React.ReactNode;
}

export function ChatSidebar({ onClose }: ChatSidebarProps) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const { toast } = useToast();
  const { chats, contacts, groups, openChat } = useChat();
  const { socket, disconnect } = useSocket();
  const [searchQuery, setSearchQuery] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  console.log('Chats:', chats);
  console.log('Contacts:', contacts);
  console.log('Groups:', groups);

  const filteredContacts = useMemo(() => {
    if (!Array.isArray(contacts)) return [];
    return (contacts as unknown as BaseUser[]).filter(contact =>
      contact.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      contact.username?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [contacts, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!Array.isArray(groups)) return [];
    return (groups as unknown as BaseChat[]).filter(group =>
      group.name?.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [groups, searchQuery]);

  const filteredChats = useMemo(() => {
    if (!Array.isArray(chats)) return [];
    return (chats as unknown as BaseChat[]).filter(chat => {
      if (chat.isGroup) {
        return chat.name?.toLowerCase().includes(searchQuery.toLowerCase());
      }
      const otherParticipant = chat.participants.find(
        (p) => {
          const participantId = p._id || p.id;
          const userId = user?.id || (user as any)?._id;
          return participantId !== userId;
        }
      );
      return otherParticipant && (
        otherParticipant.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        otherParticipant.username?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    });
  }, [chats, searchQuery, user]);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const handleLogout = useCallback(async () => {
    try {
      console.log('Logging out...');
      
      // Disconnect socket connection first
      disconnect();
      
      // Call logout function from auth context
      // This will remove token from localStorage and update user state
      logout();
      
      // Show success toast
      toast({
        title: 'Logged out successfully',
        variant: 'success',
        duration: 3000
      });
      
      // Redirect to login page
      window.location.href = '/auth/login';
    } catch (error) {
      console.error('Logout error:', error);
      toast({
        title: 'Logout failed',
        description: 'Please try again or refresh the page',
        variant: 'error',
        duration: 3000
      });
    }
  }, [logout, toast, disconnect]);

  const handleChatClick = useCallback((chatId: string) => {
    console.log('Opening chat with ID:', chatId);
    openChat(chatId);
    onClose(); // Close the sidebar on mobile after selecting a chat
  }, [openChat, onClose]);

  const handleContactClick = useCallback((contact: any) => {
    console.log('Opening chat with contact:', contact);
    openChat(null, contact);
    onClose(); // Close the sidebar on mobile after selecting a contact
  }, [openChat, onClose]);

  const noResultsMessage = useMemo(() => (
    searchQuery ? 'No matches found' : 'Nothing to display yet'
  ), [searchQuery]);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header with user info */}
      <div className="flex items-center justify-between p-4 border-b shrink-0">
        <div
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => setProfileOpen(true)}
        >
          <Avatar>
            <AvatarImage src={user?.profilePicture} />
            <AvatarFallback>{user?.name?.charAt(0) || 'U'}</AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium">{user?.name}</p>
            <p className="text-xs text-muted-foreground">@{user?.username}</p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </Button>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onClose}>
            <X size={20} />
          </Button>
        </div>
      </div>

      {/* Search and New Chat button */}
      <div className="p-4 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search people and chats..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          className="w-full gap-2"
          onClick={() => setNewChatOpen(true)}
        >
          <MessageSquarePlus size={20} />
          New Chat
        </Button>
      </div>

      {/* Tabs for chats/contacts */}
      <Tabs defaultValue="chats" className="flex-1 flex flex-col min-h-0">
        <TabsList className="grid grid-cols-3 px-4 shrink-0">
          <TabsTrigger value="chats">Chats</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabContent<Chat>
          value="chats"
          items={filteredChats}
          noResultsMessage={noResultsMessage}
          renderItem={(chat) => {
            if (chat.isGroup) {
              return (
                <GroupItem 
                  key={chat._id || chat.id} 
                  group={chat} 
                  onClick={() => handleChatClick(chat.id)}
                />
              );
            }

            const otherParticipant = chat.participants.find(
              (p) => {
                const participantId = p._id || p.id;
                const userId = user?.id || (user as any)?._id;
                return participantId !== userId;
              }
            );

            if (!otherParticipant) return null;

            return (
              <ContactItem
                key={chat._id || chat.id}
                contact={otherParticipant}
                lastMessage={chat.lastMessage}
                chatId={chat.id}
                onClick={() => handleChatClick(chat._id)}
              />
            );
          }}
        />

        <TabContent<User>
          value="contacts"
          items={filteredContacts}
          noResultsMessage={noResultsMessage}
          renderItem={(contact) => (
            <ContactItem 
              key={contact._id || contact.id} 
              contact={contact}
              onClick={() => handleContactClick(contact)}
            />
          )}
        />

        <TabContent<Chat>
          value="groups"
          items={filteredGroups}
          noResultsMessage={noResultsMessage}
          renderItem={(group) => (
            <GroupItem 
              key={group._id || group.id} 
              group={group}
              onClick={() => handleChatClick(group.id)} 
            />
          )}
        />
      </Tabs>

      {/* Footer buttons */}
      <div className="p-4 border-t shrink-0 bg-card">
        <div className="flex justify-between gap-2">
          <Button variant="outline" size="icon" onClick={() => setNewGroupOpen(true)} className="h-10 w-10">
            <Users size={20} />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setProfileOpen(true)} className="h-10 w-10">
            <UserCircle size={20} />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setSettingsOpen(true)} className="h-10 w-10">
            <Settings size={20} />
          </Button>
          <Button variant="outline" size="icon" onClick={handleLogout} className="h-10 w-10">
            <LogOut size={20} />
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      <CreateChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
      <CreateGroupDialog open={newGroupOpen} onOpenChange={setNewGroupOpen} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

function TabContent<T extends { _id?: string; id?: string }>({
  value,
  items,
  noResultsMessage,
  renderItem,
}: TabContentProps<T>) {
  return (
    <TabsContent value={value} className="flex-1 min-h-0">
      <ScrollArea className="h-[calc(100vh-20rem)]">
        <div className="space-y-1 p-2">
          {items.length > 0 ? (
            items.map(renderItem)
          ) : (
            <div className="py-12 text-center text-muted-foreground">
              {noResultsMessage}
            </div>
          )}
        </div>
      </ScrollArea>
    </TabsContent>
  );
}