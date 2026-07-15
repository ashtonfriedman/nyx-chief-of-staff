// Node type taxonomy — mapped to IDEA vault structure
export const NodeType = {
  // Structural — created from folder layout
  Domain:        'domain',
  Initiative:    'initiative',
  ExpertiseArea: 'expertise',
  Person:        'person',

  // Content — extracted from markdown
  Decision:      'decision',
  Concept:       'concept',
  Pattern:       'pattern',
  Rule:          'rule',
  NextAction:    'next_action',
};

export const RelationshipType = {
  // Structural
  BelongsTo:    'belongs_to',
  ContainedIn:  'contained_in',

  // Content
  RelatesTo:    'relates_to',
  DependsOn:    'depends_on',
  Supersedes:   'supersedes',
  BlockedBy:    'blocked_by',
  MentionedIn:  'mentioned_in',
  WikilinksTo:  'wikilinks_to',

  // Cross-instance (future)
  MirroredBy:   'mirrored_by',
};
