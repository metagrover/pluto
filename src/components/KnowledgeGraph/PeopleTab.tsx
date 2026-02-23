import type React from 'react';
import { useEffect, useState } from 'react';
import { type Entity, getEntitiesByType } from '../../api/knowledgeGraph';

export const PeopleTab: React.FC = () => {
  const [people, setPeople] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPeople = async () => {
      setLoading(true);
      try {
        const data = await getEntitiesByType('person');
        setPeople(data);
      } catch (error) {
        console.error('Failed to fetch people:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchPeople();
  }, []);

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 bg-pro-bg rounded-3xl" />
        ))}
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
        <div className="text-4xl">👤</div>
        <div className="space-y-1">
          <h3 className="text-lg font-bold text-pro-text-main">
            No People Found
          </h3>
          <p className="text-sm text-pro-text-muted">
            Speakers and people mentioned in meetings will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {people.map((person) => (
        <div
          key={person.id}
          className="p-6 bg-white border border-pro-border rounded-[2rem] shadow-sm hover:shadow-md transition-all group"
        >
          <div className="flex items-start justify-between mb-4">
            <div className="w-12 h-12 rounded-2xl bg-pro-bg flex items-center justify-center text-xl group-hover:scale-110 transition-transform">
              👤
            </div>
            <div className="text-[10px] font-bold text-pro-text-muted/30 uppercase tracking-widest">
              Person
            </div>
          </div>
          <h3 className="text-lg font-black text-pro-text-main mb-1">
            {person.name}
          </h3>
          <p className="text-xs text-pro-text-muted font-medium mb-4">
            {JSON.parse(person.metadata || '{}').role || 'Contact'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="px-4 py-1.5 rounded-xl bg-pro-bg text-[10px] font-bold uppercase tracking-widest hover:bg-pro-accent hover:text-white transition-all">
              View Profile
            </button>
            <button type="button" className="w-8 h-8 rounded-xl bg-pro-bg flex items-center justify-center hover:bg-white border border-transparent hover:border-pro-border transition-all">
              📞
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
