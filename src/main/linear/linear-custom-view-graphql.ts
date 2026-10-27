import { HELIX_ISSUE_FIELDS, HELIX_PROJECT_FIELDS } from './linear-project-graphql'

export const CUSTOM_VIEWS_QUERY = `
  query HelixLinearCustomViews(
    $first: Int,
    $filter: CustomViewFilter,
    $orderBy: PaginationOrderBy
  ) {
    customViews(first: $first, filter: $filter, orderBy: $orderBy) {
      nodes {
        id
        name
        description
        modelName
        color
        icon
        shared
        slugId
        createdAt
        updatedAt
        team {
          id
          name
          key
        }
        owner {
          id
          displayName
          avatarUrl
        }
        creator {
          id
          displayName
          avatarUrl
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`

export const CUSTOM_VIEW_QUERY = `
  query HelixLinearCustomView($id: String!) {
    customView(id: $id) {
      id
      name
      description
      modelName
      color
      icon
      shared
      slugId
      createdAt
      updatedAt
      team {
        id
        name
        key
      }
      owner {
        id
        displayName
        avatarUrl
      }
      creator {
        id
        displayName
        avatarUrl
      }
    }
  }
`

export const CUSTOM_VIEW_ISSUES_QUERY = `
  query HelixLinearCustomViewIssues(
    $id: String!,
    $first: Int,
    $after: String,
    $orderBy: PaginationOrderBy
  ) {
    customView(id: $id) {
      id
      modelName
      issues(first: $first, after: $after, orderBy: $orderBy) {
        nodes {
          ${HELIX_ISSUE_FIELDS}
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`

export const CUSTOM_VIEW_PROJECTS_QUERY = `
  query HelixLinearCustomViewProjects($id: String!, $first: Int, $orderBy: PaginationOrderBy) {
    customView(id: $id) {
      id
      modelName
      projects(first: $first, orderBy: $orderBy) {
        nodes {
          ${HELIX_PROJECT_FIELDS}
        }
        pageInfo {
          hasNextPage
        }
      }
    }
  }
`
