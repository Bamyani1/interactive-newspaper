import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ArticleCard } from '../ArticleCard';
import { Article } from '../../data/mockData';

// Mock mockData Article
const mockArticle: Article = {
    id: 'test-1',
    headline: 'Test Headline',
    date: '1986-01-01',
    category: 'News',
    summary: 'Test summary',
    fullText: '<p>Full text content</p>',
    imageUrl: '/test.jpg',
    isFeatured: false,
    isHero: false
};

describe('ArticleCard', () => {
    it('renders headline and summary', () => {
        render(<ArticleCard article={mockArticle} />);
        expect(screen.getByText('Test Headline')).toBeDefined();
        expect(screen.getByText('Test summary')).toBeDefined();
    });

    it('toggles expansion on click', () => {
        const onToggle = vi.fn();
        render(<ArticleCard article={mockArticle} isExpanded={false} onToggle={onToggle} />);
        
        const card = screen.getByText('Test Headline').closest('article');
        if (card) fireEvent.click(card);
        
        expect(onToggle).toHaveBeenCalled();
    });

    it('toggles expansion on Enter key', () => {
        const onToggle = vi.fn();
        render(<ArticleCard article={mockArticle} isExpanded={false} onToggle={onToggle} />);
        
        const card = screen.getByText('Test Headline').closest('article');
        if (card) fireEvent.keyDown(card, { key: 'Enter' });
        
        expect(onToggle).toHaveBeenCalled();
    });
});
