import json
import os
from pathlib import Path

# Data from 1986-10-17 edition (Manually curated subset to restore data)
raw_articles = [
    {
      "id": "1986-10-17-p1-owu-shooting-for-level-giving",
      "date": "1986-10-17",
      "category": "Features",
      "headline": "OWU shooting for level giving",
      "summary": "The director of the annual fund is aiming to maintain last year's fundraising success with a goal of $1.65 million, using slightly different strategies.",
      "fullText": "<p>How do you follow an act like that?</p><p>This was the question Donna Burtch, director of the annual fund, must have asked herself...</p>",
      "imageUrl": None,
      "page": 1,
      "isHero": True,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p1-key-administrator-exodus-brings-in-warrens-team",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Key administrator exodus brings in Warren's team",
      "summary": "Since President David Warren took office in 1984, there has been a significant turnover of key administrators...",
      "fullText": "<p>In March 1984 the top executive position of Ohio Wesleyan was assumed by David Warren...</p>",
      "imageUrl": None,
      "page": 1,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p1-long-wait-inevitable-says-phone-operator",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Long wait inevitable, says phone operator",
      "summary": "A university phone operator explains that long waits for long-distance calls are due to understaffing...",
      "fullText": "<p>The story is a familiar one to most Ohio Wesleyan students...</p>",
      "imageUrl": None,
      "page": 1,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p1-owu-beauties-to-grace-calendars",
      "date": "1986-10-17",
      "category": "Social",
      "headline": "OWU beauties to grace calendars",
      "summary": "Seniors Melissa Batty and Luisa Cestari are producing limited-edition men's and women's calendars...",
      "fullText": "<p>Christmas presents featuring campus faces will make a debut at the OWU Bookstore...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p1-i2.jpg",
      "page": 1,
      "isHero": False,
      "isFeatured": True,
      "imageCaption": "ENTREPRENEURS - Seniors Melissa Batty (left) and Luisa Cestari..."
    },
    {
      "id": "1986-10-17-p2-senior-returns-from-senegal-with-husband",
      "date": "1986-10-17",
      "category": "Features",
      "headline": "Senior returns from Senegal with husband",
      "summary": "Senior Dana Jackson returned from studying abroad in Senegal with a new husband, Mamadou Gueye.",
      "fullText": "<p>Most students come back from off-campus experiences with heightened cultural awareness...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p2-i1.jpg",
      "page": 2,
      "isHero": False,
      "isFeatured": True,
      "imageCaption": "HERE COMES THE BRIDE - Senior Dana Jackson and Mamadou Gueye..."
    },
    {
      "id": "1986-10-17-p2-black-family-weekend-is-here",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Black family weekend is here",
      "summary": "The Student Union on Black Awareness (SUBA) and other organizations are sponsoring the first Black Family Weekend...",
      "fullText": "<p>The Student Union on Black Awareness (SUBA), Alpha Phi Alpha fraternity...</p>",
      "imageUrl": None,
      "page": 2,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p2-tau-kappa-epsilon",
      "date": "1986-10-17",
      "category": "Ads",
      "headline": "The Brothers of Tau Kappa Epsilon Fraternity",
      "summary": "Welcome parents to Fallfest.",
      "fullText": "<p>The Brothers of Tau Kappa Epsilon Fraternity Welcome Parents...</p>",
      "imageUrl": None,
      "page": 2,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p3-mmmmm",
      "date": "1986-10-17",
      "category": "Social",
      "headline": "MMMMM!",
      "summary": "Photo feature of Patrick, son of residential life coordinator.",
      "fullText": "<p>MMMMM! \"This cookie dough is good,\" says Patrick...</p>",
      "imageUrl": None,
      "page": 3,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p3-grand-opening",
      "date": "1986-10-17",
      "category": "Ads",
      "headline": "GRAND OPENING FRIDAY, OCTOBER 17",
      "summary": "Toujours is having its grand opening.",
      "fullText": "<p>GRAND OPENING FRIDAY, OCTOBER 17...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p3-i1.jpg",
      "page": 3,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p4-faculty-may-see-staff-salaries",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Faculty may see staff salaries",
      "summary": "The faculty requested administrator's salary ranges...",
      "fullText": "<p>The faculty asked that it be provided with administrator's salary ranges...</p>",
      "imageUrl": None,
      "page": 4,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p4-former-professors-art-shown",
      "date": "1986-10-17",
      "category": "Arts",
      "headline": "Former professor's art shown",
      "summary": "An exhibition of paintings and photographs by former Ohio Wesleyan professor Jarvis Stewart...",
      "fullText": "<p>The wide-ranging talents of former Ohio Wesleyan professor Jarvis Stewart...</p>",
      "imageUrl": None,
      "page": 4,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p4-red-and-black-review",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Jazzy nightclub acts to be held in MUB",
      "summary": "The Red and Black Review will be presented Saturday...",
      "fullText": "<p>The Red and Black Review will be presented Saturday at 9 p.m...</p>",
      "imageUrl": None,
      "page": 4,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p6-missed-opportunities",
      "date": "1986-10-17",
      "category": "Editorial",
      "headline": "Missed opportunities",
      "summary": "Editorial criticizing Reagan's focus on Star Wars.",
      "fullText": "<p>EDITORIAL</p><p>Missed opportunities</p><p>The world would probably be a safer place...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p6-i3.jpg",
      "page": 6,
      "isHero": False,
      "isFeatured": True
    },
    {
      "id": "1986-10-17-p6-chilly-rooms",
      "date": "1986-10-17",
      "category": "Editorial",
      "headline": "Chilly rooms are for learning",
      "summary": "Letter to editor about lack of heat.",
      "fullText": "<p>Letters</p><p>Chilly rooms are for learning...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p6-i4.jpg",
      "page": 6,
      "isHero": False,
      "isFeatured": True
    },
    {
      "id": "1986-10-17-p6-letter-phobia",
      "date": "1986-10-17",
      "category": "Features",
      "headline": "Curing students' letter phobia",
      "summary": "Columnist Joe Pember discusses writing home.",
      "fullText": "<p>Curing students' letter phobia...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p6-i1.jpg",
      "page": 6,
      "isHero": False,
      "isFeatured": True
    },
    {
      "id": "1986-10-17-p7-professor-praises-workshop",
      "date": "1986-10-17",
      "category": "News",
      "headline": "Professor praises workshop",
      "summary": "A professor evaluates a recent multicultural workshop.",
      "fullText": "<p>Was the multicultural workshop a success?</p><p>Overall, I thought it was...</p>",
      "imageUrl": None,
      "page": 7,
      "isHero": False,
      "isFeatured": False
    },
    {
      "id": "1986-10-17-p7-cars-on-campus",
      "date": "1986-10-17",
      "category": "Features",
      "headline": "Cars on campus cause troubles",
      "summary": "Student columnist on car troubles.",
      "fullText": "<p>With that good ole' \"going home\" feeling last Friday...</p>",
      "imageUrl": "/editions/1986-10-17/extracted-images/p7-i2.jpg",
      "page": 7,
      "isHero": False,
      "isFeatured": True
    },
    {
      "id": "1986-10-17-p8-merger-rise",
      "date": "1986-10-17",
      "category": "Features",
      "headline": "Speaker explains merger rise",
      "summary": "A Wall Street managing director discussed acquisitions.",
      "fullText": "<p>In a speech diverging from the recent discussions of the Constitution...</p>",
      "imageUrl": None,
      "page": 8,
      "isHero": False,
      "isFeatured": False
    }
]

def map_category(article):
    cat = article.get("category", "News")
    headline = article.get("headline", "")
    
    # Strict mapping
    if cat == "Social":
        return "Campus Life"
    if cat == "Editorial":
        return "Opinion"
    if cat == "Business":
        return "News"
    
    # Contextual updates
    if "Fraternity" in headline or "Sorority" in headline or "Brothers of" in headline or "Sisters of" in headline:
        return "Campus Life"
        
    if "Review" in headline and cat == "News":
        return "Campus Life" # "Red and Black Review" is an event
        
    if "phobia" in headline or "praises workshop" in headline or "Cars on campus" in headline:
        return "Opinion" # Columns/Op-eds
        
    return cat

def main():
    cleaned_articles = []
    
    for art in raw_articles:
        art["category"] = map_category(art)
        cleaned_articles.append(art)
        
    edition_data = {
        "edition": "1986-10-17",
        "pageCount": 12,
        "articleCount": len(cleaned_articles),
        "articles": cleaned_articles
    }
    
    output_path = Path("data/ocr-output/1986-10-17/edition.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, "w") as f:
        json.dump(edition_data, f, indent=2)
        
    print(f"Recovered {len(cleaned_articles)} articles to {output_path}")

if __name__ == "__main__":
    main()
